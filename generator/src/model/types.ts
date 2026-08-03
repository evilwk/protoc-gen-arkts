import type {
  IDescriptorProto,
  IEnumDescriptorProto,
  IFileDescriptorProto
} from 'protobufjs/ext/descriptor/index.js';

export const LABEL_REPEATED = 3;
export const TYPE_GROUP = 10;
export const TYPE_MESSAGE = 11;
export const TYPE_BYTES = 12;
export const TYPE_ENUM = 14;

export interface GeneratorRequest {
  readonly filesToGenerate: string[];
  readonly parameter: string;
  readonly protoFiles: IFileDescriptorProto[];
}

export interface GeneratedFile {
  readonly name: string;
  readonly content: string;
}

export interface PluginOptions {
  /**
   * 以 "." 开头视为相对输出根的路径，否则视为 HarmonyOS 模块名。
   */
  readonly runtimeImport: string;

  /**
   * 本次生成文件的输出前缀；两个前缀同时为空时退化为单组无前缀模式。
   */
  readonly groupPrefix: string;

  /**
   * 另一组的输出前缀，用于计算跨组 import。
   */
  readonly otherGroupPrefix: string;

  /**
   * 另一组的逻辑 proto 路径清单。
   */
  readonly otherGroupFiles: ReadonlySet<string>;
}

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

export interface FileModel {
  readonly file: IFileDescriptorProto;
  readonly fileName: string;
  readonly outputName: string | undefined;
  readonly symbols: TypeSymbol[];
}

export interface ScalarShape {
  readonly arkType: string;
  readonly defaultValue: string;
  readonly writerMethod: string;
  readonly readerMethod: string;
  readonly wireType: string;
}

interface FieldModelBase extends ScalarShape {
  readonly protoName: string;
  readonly name: string;
  readonly number: number;
  readonly type: number;
  readonly typeName: string;
  readonly repeated: boolean;
  readonly packed: boolean;
  readonly oneofIndex?: number;
}

export interface ScalarFieldModel extends FieldModelBase {
  readonly kind: 'scalar';
}

export interface EnumFieldModel extends FieldModelBase {
  readonly kind: 'enum';
  readonly symbol: EnumTypeSymbol;
}

export interface MessageFieldModel extends FieldModelBase {
  readonly kind: 'message';
  readonly symbol: MessageTypeSymbol;
}

export type ValueFieldModel = ScalarFieldModel | EnumFieldModel | MessageFieldModel;

export interface MapFieldModel extends FieldModelBase {
  readonly kind: 'map';
  readonly symbol: MapTypeSymbol;
  readonly mapKey: ScalarFieldModel;
  readonly mapValue: ValueFieldModel;
}

export type FieldModel = ValueFieldModel | MapFieldModel;
