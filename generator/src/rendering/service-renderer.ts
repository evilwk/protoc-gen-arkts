import type { DescriptorModel } from '../model/descriptor-model.js';
import type {
  FileModel,
  MessageTypeSymbol,
  ServiceMethodModel,
  ServiceModel,
  TypeSymbol,
} from '../model/symbols.js';
import { indent } from '../naming.js';
import { renderSource } from '../source-template.js';

export interface ResolvedServiceMethod {
  readonly method: ServiceMethodModel;
  readonly input: MessageTypeSymbol;
  readonly output: MessageTypeSymbol;
}

/**
 * 解析 service 中的 unary 请求与响应类型，按方法声明顺序返回。
 */
export function resolveServiceMethods(
  service: ServiceModel,
  file: FileModel,
  model: DescriptorModel,
): ResolvedServiceMethod[] {
  return service.methods.map((method): ResolvedServiceMethod => {
    const context: string = `${file.fileName}: service ${service.protoName} method ${method.protoName}`;
    return {
      method,
      input: requireMessage(model.requireSymbol(method.inputFullName, `${context}: request`), `${context}: request`),
      output: requireMessage(model.requireSymbol(method.outputFullName, `${context}: response`), `${context}: response`),
    };
  });
}

/**
 * 渲染一个 service 的强类型调用 API 与统一响应解码边界。
 */
export class ArkTSServiceRenderer {
  public constructor(
    private readonly service: ServiceModel,
    private readonly file: FileModel,
    private readonly model: DescriptorModel,
    private readonly imports: ReadonlyMap<string, string>,
  ) {}

  public render(): string | undefined {
    const methods: ResolvedServiceMethod[] = resolveServiceMethods(this.service, this.file, this.model);
    if (methods.length === 0) {
      return undefined;
    }

    const serviceName: string = this.service.arkName;
    const rpcMethods: string = methods.map((entry): string => this.renderRpcMethod(entry)).join('\n\n');
    const decodeCases: string = methods
      .map((entry): string => `case '${entry.method.protoName}':\n  return ${this.arkType(entry.output)}.decode(bytes);`)
      .join('\n');
    const errorMessage: string = `\`Unknown RPC response: \${${serviceName}.SERVICE_NAME}/\${method}\``;

    return renderSource`
      export class ${serviceName} {
        static readonly SERVICE_NAME: string = '${this.service.protoName}';

        private readonly client: RpcClient;

        constructor(client: RpcClient) {
          this.client = client;
        }

      ${indent(rpcMethods)}

        static decodeResponse(method: string, bytes: ProtoBytes): ProtoMessage {
          switch (method) {
      ${indent(decodeCases, 6)}
            default:
              throw new Error(${errorMessage});
          }
        }
      }`;
  }

  private renderRpcMethod(entry: ResolvedServiceMethod): string {
    const requestType: string = this.arkType(entry.input);
    const responseType: string = this.arkType(entry.output);
    return renderSource`
      ${entry.method.arkName}(request: ${requestType}): Promise<${responseType}> {
        return this.client.invoke<${responseType}>(
          ${this.service.arkName}.SERVICE_NAME,
          '${entry.method.protoName}',
          request
        );
      }`;
  }

  private arkType(symbol: MessageTypeSymbol): string {
    return symbol.fileName === this.file.fileName
      ? symbol.arkName
      : (this.imports.get(symbol.fullName) ?? symbol.arkName);
  }
}

function requireMessage(symbol: TypeSymbol, context: string): MessageTypeSymbol {
  if (symbol.kind !== 'message') {
    throw new Error(`${context}: type ${symbol.fullName} is not a message`);
  }
  return symbol;
}
