import type { IDescriptorProto, IEnumDescriptorProto, IFileDescriptorProto } from 'protobufjs/ext/descriptor/index.js';

interface TypeSymbolBase {
  readonly fullName: string;
  readonly arkName: string;
  readonly fileName: string;
}

export interface MessageTypeSymbol extends TypeSymbolBase {
  readonly kind: 'message';
  readonly message: IDescriptorProto;
}

export interface MapTypeSymbol extends TypeSymbolBase {
  readonly kind: 'map';
  readonly message: IDescriptorProto;
}

export interface EnumTypeSymbol extends TypeSymbolBase {
  readonly kind: 'enum';
  readonly enum: IEnumDescriptorProto;
  readonly enumValues: readonly number[];
}

export type TypeSymbol = MessageTypeSymbol | MapTypeSymbol | EnumTypeSymbol;

/**
 * 可直接作为字段类型的符号，排除 MapTypeSymbol 类型。
 */
export type FieldTypeSymbol = Exclude<TypeSymbol, MapTypeSymbol>;

/**
 * rpc 方法信息
 */
export interface ServiceMethodModel {
  readonly protoName: string;
  readonly outputFullName: string;
}

export interface ServiceModel {
  readonly protoName: string;
  readonly arkName: string;
  readonly fullName: string;
  readonly methods: readonly ServiceMethodModel[];
}

export interface FileModel {
  readonly file: IFileDescriptorProto;
  readonly fileName: string;
  readonly outputName: string | undefined;
  readonly symbols: TypeSymbol[];
  readonly services: ServiceModel[];
}
