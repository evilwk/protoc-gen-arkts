import type { DescriptorModel } from '../model/descriptor-model.js';
import type { FileModel, MessageTypeSymbol, ServiceMethodModel, ServiceModel, TypeSymbol } from '../model/symbols.js';
import { renderSource } from '../source-template.js';

/**
 * 解析 service 中可解码的响应类型符号，按方法声明顺序返回。
 */
export function decodableResponses(
  service: ServiceModel,
  file: FileModel,
  model: DescriptorModel,
): Array<{ readonly method: ServiceMethodModel; readonly symbol: MessageTypeSymbol }> {
  const resolved: Array<{ method: ServiceMethodModel; symbol: MessageTypeSymbol }> = [];
  for (const method of service.methods) {
    const context: string = `${file.fileName}: service ${service.protoName} method ${method.protoName}`;
    const symbol: TypeSymbol = model.requireSymbol(method.outputFullName, context);
    if (symbol.kind !== 'message') {
      throw new Error(`${context}: response type ${symbol.fullName} is not a message`);
    }
    resolved.push({ method, symbol });
  }
  return resolved;
}

/**
 * 渲染一个 service 的响应解码注册表。
 */
export class ArkTSServiceRenderer {
  public constructor(
    private readonly service: ServiceModel,
    private readonly file: FileModel,
    private readonly model: DescriptorModel,
    private readonly imports: ReadonlyMap<string, string>,
  ) {}

  /**
   * 无可解码方法时返回 undefined，避免产出空注册表。
   */
  public render(): string | undefined {
    const entries: string[] = [];
    for (const entry of decodableResponses(this.service, this.file, this.model)) {
      const { fileName, arkName, fullName } = entry.symbol;
      const arkType: string = fileName === this.file.fileName ? arkName : (this.imports.get(fullName) ?? arkName);
      entries.push(`['${entry.method.protoName}', ${arkType}.decode as ${this.decoderTypeName()}]`);
    }

    if (entries.length === 0) {
      return undefined;
    }

    const decoderType: string = this.decoderTypeName();
    const mapName: string = this.registryName();
    return renderSource`
      type ${decoderType} = (bytes: Uint8Array | collections.Uint8Array) => lang.ISendable;

      export const ${mapName}: Map<string, ${decoderType}> = new Map<string, ${decoderType}>([
      ${entries.map((entry): string => `  ${entry}`).join(',\n')}
      ]);`;
  }

  private decoderTypeName(): string {
    return `${this.service.arkName}RspDecoder`;
  }

  private registryName(): string {
    return `${toSnakeUpper(this.service.arkName)}_RSP_DECODERS`;
  }
}

function toSnakeUpper(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
}
