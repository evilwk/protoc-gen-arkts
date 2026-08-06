import type {
  IDescriptorProto,
  IEnumDescriptorProto,
  IFileDescriptorProto,
  IServiceDescriptorProto,
} from 'protobufjs/ext/descriptor/index.js';
import { outputName, requireProtoIdentifier, toUpperCamel } from '../naming.js';
import type { PluginOptions } from './plugin.js';
import type { FileModel, ServiceMethodModel, TypeSymbol } from './symbols.js';

/**
 * 已校验的 descriptor 文件与符号索引。
 */
export class DescriptorModel {
  private constructor(
    private readonly filesByName: ReadonlyMap<string, FileModel>,
    private readonly symbolsByName: ReadonlyMap<string, TypeSymbol>,
  ) {}

  public static build(
    protoFiles: IFileDescriptorProto[],
    filesToGenerate: string[],
    options: PluginOptions,
  ): DescriptorModel {
    const indexes: DescriptorIndexes = new DescriptorModelBuilder(protoFiles, filesToGenerate, options).build();
    return new DescriptorModel(indexes.files, indexes.symbols);
  }

  public requireFile(fileName: string, context: string = fileName): FileModel {
    const file: FileModel | undefined = this.filesByName.get(fileName);
    if (file === undefined) {
      throw new Error(`${context}: descriptor for file "${fileName}" was not provided`);
    }
    return file;
  }

  public requireSymbol(fullName: string, context: string): TypeSymbol {
    const symbol: TypeSymbol | undefined = this.symbolsByName.get(fullName);
    if (symbol === undefined) {
      throw new Error(`${context}: unresolved protobuf type ${fullName || '<missing>'}`);
    }
    return symbol;
  }

  public requireOutputName(file: FileModel, context: string): string {
    if (file.outputName === undefined) {
      throw new Error(
        `${context}: dependency "${file.fileName}" is imported but not generated; ` +
          `pass it to protoc or declare its root with dep_root`,
      );
    }
    return file.outputName;
  }
}

/**
 * 按稳定顺序建立 DescriptorModel，并在渲染前关闭文件和符号级错误。
 */
class DescriptorModelBuilder {
  private readonly files: Map<string, FileModel> = new Map();
  private readonly symbols: Map<string, TypeSymbol> = new Map();
  private readonly generated: Set<string>;
  private readonly outputs: Map<string, string> = new Map();

  public constructor(
    private readonly protoFiles: IFileDescriptorProto[],
    private readonly filesToGenerate: string[],
    private readonly options: PluginOptions,
  ) {
    const duplicateTargets: string[] = findDuplicates(filesToGenerate);
    if (duplicateTargets.length > 0) {
      throw new Error(`duplicate file_to_generate entries: ${duplicateTargets.join(', ')}`);
    }
    this.generated = new Set(filesToGenerate);
  }

  public build(): DescriptorIndexes {
    const orderedFiles: IFileDescriptorProto[] = [...this.protoFiles].sort((left, right): number =>
      compareText(left.name ?? '', right.name ?? ''),
    );
    for (const descriptor of orderedFiles) {
      this.addFile(descriptor);
    }
    for (const fileName of [...this.generated].sort()) {
      if (!this.files.has(fileName)) {
        throw new Error(`descriptor for file "${fileName}" was not provided`);
      }
    }
    return { files: this.files, symbols: this.symbols };
  }

  private addFile(file: IFileDescriptorProto): void {
    const fileName: string = requireFileName(file.name);
    if (this.files.has(fileName)) {
      throw new Error(`duplicate file descriptor "${fileName}"`);
    }

    if (file.syntax !== 'proto3') {
      throw new Error(`${fileName}: only syntax = "proto3" is supported`);
    }

    const resolvedOutput: string | undefined = this.resolveOutputName(fileName);
    if (resolvedOutput !== undefined) {
      const existingFile: string | undefined = this.outputs.get(resolvedOutput);
      if (existingFile !== undefined) {
        const conflicts: string[] = [existingFile, fileName].sort();
        throw new Error(`generated output ${resolvedOutput} conflicts between ${conflicts[0]} and ${conflicts[1]}`);
      }
      this.outputs.set(resolvedOutput, fileName);
    }

    const fileModel: FileModel = {
      file,
      fileName,
      outputName: resolvedOutput,
      symbols: [],
      services: [],
    };
    this.files.set(fileName, fileModel);
    this.collectFileSymbols(fileModel);
  }

  /**
   * 本次 `file_to_generate` 内的文件使用 `output_prefix`，`dep_root` 遍历到的依赖使用 `dep_prefix`。
   * 两者都不匹配的文件不参与生成也不参与 import，返回 undefined 由调用方按需报错。
   */
  private resolveOutputName(fileName: string): string | undefined {
    const { outputPrefix, depPrefix, depFiles } = this.options;
    const relative: string = outputName(fileName);
    if (this.generated.has(fileName)) {
      return withPrefix(outputPrefix, relative);
    }
    if (depFiles.has(fileName)) {
      return withPrefix(depPrefix, relative);
    }
    return undefined;
  }

  private collectFileSymbols(file: FileModel): void {
    new FileSymbolCollector(file, this.symbols).collect();
  }
}

/**
 * 收集单个文件的符号，并关闭文件内的重名与扁平化名冲突。
 */
class FileSymbolCollector {
  private readonly packagePrefix: string;
  private readonly localNames: Map<string, string> = new Map();

  public constructor(
    private readonly file: FileModel,
    private readonly symbols: Map<string, TypeSymbol>,
  ) {
    this.packagePrefix = file.file.package ? `.${file.file.package}` : '';
  }

  public collect(): void {
    this.processEnums(this.file.file.enumType ?? [], [], []);
    this.processMessages(this.file.file.messageType ?? [], [], []);
    this.processServices(this.file.file.service ?? []);
  }

  private processServices(services: IServiceDescriptorProto[]): void {
    const fileName: string = this.file.fileName;
    const serviceArkNames: Map<string, string> = new Map();

    for (const service of services) {
      const protoName: string = requireProtoIdentifier(service.name, `${fileName}: service name`);
      const arkName: string = toUpperCamel(protoName);

      // 服务名重复
      const existing: string | undefined = serviceArkNames.get(arkName);
      if (existing !== undefined) {
        const conflicts: string[] = [existing, protoName].sort();
        throw new Error(
          `${fileName}: service ArkTS name ${arkName} conflicts between ${conflicts[0]} and ${conflicts[1]}`,
        );
      }

      serviceArkNames.set(arkName, protoName);

      // 收集服务的方法，但不包含 streaming 方法
      const methods: ServiceMethodModel[] = [];
      for (const method of service.method ?? []) {
        const methodName: string = requireProtoIdentifier(method.name, `${fileName}: service ${protoName} method name`);
        if (method.clientStreaming === true || method.serverStreaming === true) {
          continue;
        }
        const outputFullName: string | undefined = method.outputType;
        if (outputFullName === undefined || outputFullName.length === 0) {
          throw new Error(`${fileName}: service ${protoName} method ${methodName} has no output type`);
        }
        methods.push({ protoName: methodName, outputFullName });
      }

      this.file.services.push({
        protoName,
        arkName,
        fullName: `${this.packagePrefix}.${protoName}`,
        methods,
      });
    }
  }

  /**
   * 登记符号，并拒绝跨文件的 protobuf 全名重复与同文件内的 ArkTS 名冲突。
   */
  private registerSymbol(symbol: TypeSymbol): void {
    const fileName: string = this.file.fileName;
    const existing: TypeSymbol | undefined = this.symbols.get(symbol.fullName);
    if (existing !== undefined) {
      const conflicts: string[] = [existing.fileName, fileName].sort();
      throw new Error(`${fileName}: duplicate protobuf symbol ${symbol.fullName} in ${conflicts.join(', ')}`);
    }

    const localPath: string | undefined = this.localNames.get(symbol.arkName);
    if (localPath !== undefined) {
      const conflicts: string[] = [localPath, symbol.fullName].sort();
      throw new Error(
        `${fileName}: flattened ArkTS type name ${symbol.arkName} conflicts between ${conflicts[0]} and ${conflicts[1]}`,
      );
    }

    this.localNames.set(symbol.arkName, symbol.fullName);
    this.symbols.set(symbol.fullName, symbol);
    this.file.symbols.push(symbol);
  }

  private processEnums(enums: IEnumDescriptorProto[], protoPath: string[], arkPath: string[]): void {
    const fileName: string = this.file.fileName;
    for (const enumDescriptor of enums) {
      const protoName: string = requireProtoIdentifier(enumDescriptor.name, `${fileName}: enum name`);

      const naming: SymbolNaming = nestedSymbolNaming(this.packagePrefix, protoPath, arkPath, protoName);

      this.registerSymbol({
        fullName: naming.fullName,
        arkName: naming.arkName,
        fileName,
        kind: 'enum',
        enum: enumDescriptor,
        enumValues: requireEnumValues(enumDescriptor, naming.fullName, fileName),
      });
    }
  }

  /**
   * ArkTS 没有 protobuf nested 声明，按“外层到内层”拼接成确定的顶层类型名。
   */
  private processMessages(messages: IDescriptorProto[], protoPath: string[], arkPath: string[]): void {
    for (const message of messages) {
      const protoName: string = requireProtoIdentifier(message.name, `${this.file.fileName}: message name`);

      const naming: SymbolNaming = nestedSymbolNaming(this.packagePrefix, protoPath, arkPath, protoName);

      this.registerSymbol({
        fullName: naming.fullName,
        arkName: naming.arkName,
        fileName: this.file.fileName,
        kind: message.options?.mapEntry === true ? 'map' : 'message',
        message,
      });

      this.processEnums(message.enumType ?? [], naming.protoPath, naming.arkPath);
      this.processMessages(message.nestedType ?? [], naming.protoPath, naming.arkPath);
    }
  }
}

interface DescriptorIndexes {
  readonly files: ReadonlyMap<string, FileModel>;
  readonly symbols: ReadonlyMap<string, TypeSymbol>;
}

/**
 * 嵌套声明在 protobuf 与 ArkTS 两侧的名字，以及供更深层嵌套继续拼接的路径。
 */
interface SymbolNaming {
  readonly fullName: string;
  readonly arkName: string;
  readonly protoPath: string[];
  readonly arkPath: string[];
}

/**
 * 由外层路径与当前声明名拼出 protobuf 全名和扁平化后的 ArkTS 名。
 */
function nestedSymbolNaming(
  packagePrefix: string,
  protoPath: string[],
  arkPath: string[],
  protoName: string,
): SymbolNaming {
  const nextProtoPath: string[] = protoPath.concat(protoName);
  const nextArkPath: string[] = arkPath.concat(toUpperCamel(protoName));
  return {
    fullName: `${packagePrefix}.${nextProtoPath.join('.')}`,
    arkName: nextArkPath.join(''),
    protoPath: nextProtoPath,
    arkPath: nextArkPath,
  };
}

/**
 * 校验 proto3 enum 的取值：每个取值需有合法名称与编号，且首个取值必须为零。
 */
function requireEnumValues(enumDescriptor: IEnumDescriptorProto, fullName: string, fileName: string): number[] {
  const enumValues: number[] = (enumDescriptor.value ?? []).map((value): number => {
    requireProtoIdentifier(value.name, `${fileName}: enum ${fullName} value`);
    if (value.number === undefined) {
      throw new Error(`${fileName}: enum ${fullName} contains a value without a number`);
    }
    return value.number;
  });

  if (enumValues.length === 0 || enumValues[0] !== 0) {
    throw new Error(`${fileName}: proto3 enum ${fullName} must declare zero as its first value`);
  }
  return enumValues;
}

function requireFileName(value: string | null | undefined): string {
  if (value === undefined || value === null || value.length === 0) {
    throw new Error('file descriptor contains an empty name');
  }
  return value;
}

function findDuplicates(values: string[]): string[] {
  const seen: Set<string> = new Set();
  const duplicates: Set<string> = new Set();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }
  return [...duplicates].sort();
}

function withPrefix(prefix: string, relative: string): string {
  return prefix.length === 0 ? relative : `${prefix}/${relative}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
