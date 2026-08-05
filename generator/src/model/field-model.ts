import type {
  EnumTypeSymbol,
  FieldTypeSymbol,
  MapTypeSymbol,
  MessageTypeSymbol
} from './symbols.js';

export interface ScalarShape {
  readonly arkType: string;
  readonly defaultValue: string;
  readonly writerMethod: string;
  readonly readerMethod: string;
  readonly wireType: string;
}

/**
 * 各类字段模型共有的属性；判别联合的各成员在此基础上追加 kind 与符号。
 */
export interface FieldModelBase extends ScalarShape {
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

/**
 * 按解析出的符号种类把字段基础属性收敛为判别联合成员。
 */
export function toValueFieldModel(
  fieldBase: FieldModelBase,
  symbol: FieldTypeSymbol | undefined
): ValueFieldModel {
  if (symbol === undefined) {
    return { kind: 'scalar', ...fieldBase } satisfies ScalarFieldModel;
  }

  if (symbol.kind === 'enum') {
    return { kind: 'enum', symbol, ...fieldBase } satisfies EnumFieldModel;
  }

  return { kind: 'message', symbol, ...fieldBase } satisfies MessageFieldModel;
}
