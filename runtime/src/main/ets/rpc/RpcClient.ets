import { ProtoMessage } from '../visitor/ProtoVisitor';

export interface RpcClient {
  invoke<Response extends ProtoMessage>(
    service: string,
    method: string,
    request: ProtoMessage
  ): Promise<Response>;
}
