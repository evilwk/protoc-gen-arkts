import type {
  IDescriptorProto,
  IEnumDescriptorProto,
  IFileDescriptorProto
} from 'protobufjs/ext/descriptor/index.js';
import { outputName, requireProtoIdentifier, toUpperCamel } from '../naming.js';
import type { FileModel, PluginOptions, TypeSymbol } from './types.js';

/**
 * 已校验的 descriptor 文件与符号索引。
 *
 * 生成与渲染阶段只通过此类解析文件、符号和输出名，避免各层重复组装诊断。
 */
export class DescriptorModel {
  private constructor(
    private readonly filesByName: ReadonlyMap<string, FileModel>,
    private readonly symbolsByName: ReadonlyMap<string, TypeSymbol>
  ) {
  }

  public static build(
    protoFiles: IFileDescriptorProto[],
    filesToGenerate: string[],
    options: PluginOptions
  ): DescriptorModel {
    const indexes: DescriptorIndexes = new DescriptorModelBuilder(
      protoFiles,
      filesToGenerate,
      options
    ).build();
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
      throw new Error(`${context}: dependency "${file.fileName}" does not belong to any protocol source group`);
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
    private readonly options: PluginOptions
  ) {
    const duplicateTargets: string[] = findDuplicates(filesToGenerate);
    if (duplicateTargets.length > 0) {
      throw new Error(`duplicate file_to_generate entries: ${duplicateTargets.join(', ')}`);
    }
    this.generated = new Set(filesToGenerate);
  }

  public build(): DescriptorIndexes {
    const orderedFiles: IFileDescriptorProto[] = [...this.protoFiles].sort(
      (left, right): number => compareText(left.name ?? '', right.name ?? '')
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
        throw new Error(
          `generated output ${resolvedOutput} conflicts between ${conflicts[0]} and ${conflicts[1]}`
        );
      }
      this.outputs.set(resolvedOutput, fileName);
    }

    const fileModel: FileModel = {
      file,
      fileName,
      outputName: resolvedOutput,
      symbols: []
    };
    this.files.set(fileName, fileModel);
    this.collectFileSymbols(fileModel);
  }

  /**
   * 按组分次生成时，本次 `file_to_generate` 内的文件使用本组前缀，另一组
   * 清单内的依赖使用另一组前缀。
   */
  private resolveOutputName(fileName: string): string | undefined {
    const relative: string = outputName(fileName);
    if (this.generated.has(fileName)) {
      return this.options.groupPrefix.length === 0
        ? relative
        : `${this.options.groupPrefix}/${relative}`;
    }
    if (this.options.otherGroupFiles.has(fileName)) {
      return `${this.options.otherGroupPrefix}/${relative}`;
    }
    // 未声明分组时保持单组无前缀行为，便于插件单测和单组生成继续使用。
    return this.options.groupPrefix.length === 0 && this.options.otherGroupPrefix.length === 0
      ? relative
      : undefined;
  }

  private collectFileSymbols(file: FileModel): void {
    const packagePrefix: string = file.file.package ? `.${file.file.package}` : '';
    const localNames: Map<string, string> = new Map();

    const add = (symbol: TypeSymbol): void => {
      const existing: TypeSymbol | undefined = this.symbols.get(symbol.fullName);
      if (existing !== undefined) {
        const conflicts: string[] = [existing.fileName, file.fileName].sort();
        throw new Error(
          `${file.fileName}: duplicate protobuf symbol ${symbol.fullName} in ${conflicts.join(', ')}`
        );
      }

      const localPath: string | undefined = localNames.get(symbol.arkName);
      if (localPath !== undefined) {
        const conflicts: string[] = [localPath, symbol.fullName].sort();
        throw new Error(
          `${file.fileName}: flattened ArkTS type name ${symbol.arkName} conflicts between ${conflicts[0]} and ${conflicts[1]}`
        );
      }

      localNames.set(symbol.arkName, symbol.fullName);
      this.symbols.set(symbol.fullName, symbol);
      file.symbols.push(symbol);
    };

    const walkEnums = (
      enums: IEnumDescriptorProto[],
      protoPath: string[],
      arkPath: string[]
    ): void => {
      for (const enumDescriptor of enums) {
        const protoName: string = requireProtoIdentifier(
          enumDescriptor.name,
          `${file.fileName}: enum name`
        );

        const arkName: string = arkPath.concat(toUpperCamel(protoName)).join('');
        const fullName: string = `${packagePrefix}.${protoPath.concat(protoName).join('.')}`;
        const enumValues: number[] = (enumDescriptor.value ?? []).map((value): number => {
          requireProtoIdentifier(value.name, `${file.fileName}: enum ${fullName} value`);
          if (value.number === undefined) {
            throw new Error(`${file.fileName}: enum ${fullName} contains a value without a number`);
          }
          return value.number;
        });

        if (enumValues.length === 0 || enumValues[0] !== 0) {
          throw new Error(`${file.fileName}: proto3 enum ${fullName} must declare zero as its first value`);
        }

        add({
          fullName,
          arkName,
          fileName: file.fileName,
          kind: 'enum',
          enum: enumDescriptor,
          enumValues
        });
      }
    };

    // ArkTS 没有 protobuf nested 声明，按“外层到内层”拼接成确定的顶层类型名。
    const walkMessages = (
      messages: IDescriptorProto[],
      protoPath: string[],
      arkPath: string[]
    ): void => {
      for (const message of messages) {
        const protoName: string = requireProtoIdentifier(
          message.name,
          `${file.fileName}: message name`
        );

        const nextProtoPath: string[] = protoPath.concat(protoName);
        const nextArkPath: string[] = arkPath.concat(toUpperCamel(protoName));
        const fullName: string = `${packagePrefix}.${nextProtoPath.join('.')}`;
        add({
          fullName,
          arkName: nextArkPath.join(''),
          fileName: file.fileName,
          kind: message.options?.mapEntry === true ? 'map' : 'message',
          message
        });

        walkEnums(message.enumType ?? [], nextProtoPath, nextArkPath);
        walkMessages(message.nestedType ?? [], nextProtoPath, nextArkPath);
      }
    };

    walkEnums(file.file.enumType ?? [], [], []);
    walkMessages(file.file.messageType ?? [], [], []);
  }
}

interface DescriptorIndexes {
  readonly files: ReadonlyMap<string, FileModel>;
  readonly symbols: ReadonlyMap<string, TypeSymbol>;
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

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
