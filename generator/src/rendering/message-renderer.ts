import type { IOneofDescriptorProto } from 'protobufjs/ext/descriptor/index.js';
import { DescriptorModel } from '../model/descriptor-model.js';
import type { FieldModel, MapFieldModel, ValueFieldModel } from '../model/field-model.js';
import type { FileModel, MessageTypeSymbol } from '../model/symbols.js';
import type { PluginOptions } from '../model/plugin.js';
import { indent, requireArkMemberName, toUpperCamel } from '../naming.js';
import { renderSource } from '../source-template.js';
import { FieldCodecRenderer } from './field-codec-renderer.js';
import { FieldModelResolver } from './field-model-resolver.js';
import { JsonCodecRenderer } from './json-codec-renderer.js';
import { isSpecialWktMessage, WktJsonCodecRenderer } from './wkt-json-codec-renderer.js';

/**
 * 渲染一个 message 的字段、oneof API 与编解码方法。
 */
export class ArkTSMessageRenderer {
  private readonly fields: FieldModel[];
  private readonly oneofs: IOneofDescriptorProto[];
  private readonly codec: FieldCodecRenderer;
  private readonly jsonCodec: JsonCodecRenderer;
  private readonly json: boolean;

  public constructor(
    private readonly symbol: MessageTypeSymbol,
    file: FileModel,
    model: DescriptorModel,
    imports: ReadonlyMap<string, string>,
    options: PluginOptions,
  ) {
    this.oneofs = symbol.message.oneofDecl ?? [];
    const resolver: FieldModelResolver = new FieldModelResolver(file, model, imports);
    this.fields = (symbol.message.field ?? []).map((field): FieldModel => resolver.resolve(field, symbol));
    this.requireUniqueMemberNames(file);
    this.codec = new FieldCodecRenderer(symbol.arkName, this.oneofs);
    this.jsonCodec = isSpecialWktMessage(symbol.fullName)
      ? new WktJsonCodecRenderer(symbol.fullName, symbol.arkName, this.oneofs, this.fields)
      : new JsonCodecRenderer(symbol.arkName, this.oneofs);
    this.json = options.json;
  }

  public render(): string {
    const messageName: string = this.symbol.arkName;
    const declarations: string[] = [];
    for (const field of this.fields) {
      if (field.oneofIndex !== undefined) {
        declarations.push(`  private ${field.name}: ${field.arkType} = ${field.defaultValue};`);
      } else {
        declarations.push(`  ${field.name}: ${field.arkType} = ${field.defaultValue};`);
      }
    }

    for (let index: number = 0; index < this.oneofs.length; index++) {
      const name: string = requireArkMemberName(this.oneofs[index]?.name, `${this.symbol.fileName}: oneof name`);
      declarations.push(`  private ${name}Case: number = 0;`);
    }

    const oneofMethods: string[] = [];
    for (let index: number = 0; index < this.oneofs.length; index++) {
      const oneofName: string = requireArkMemberName(this.oneofs[index]?.name, `${this.symbol.fileName}: oneof name`);
      const members: FieldModel[] = this.fields.filter((field): boolean => field.oneofIndex === index);
      const optionalField: ValueFieldModel | undefined = members.find(
        (field): field is ValueFieldModel => field.kind !== 'map' && field.optional === true,
      );
      oneofMethods.push(
        optionalField === undefined
          ? this.renderOneofMethods(oneofName, members)
          : this.renderOptionalMethods(oneofName, optionalField),
      );
    }

    const encoders: string = this.fields.map((field): string => this.codec.renderEncoder(field)).join('\n');
    const decoders: string = this.fields.map((field): string => this.codec.renderDecoder(field)).join('\n');
    const mapReaders: string = this.fields
      .filter((field): field is MapFieldModel => field.kind === 'map')
      .map((field): string => this.codec.renderMapReader(field))
      .join('\n\n');

    const methodParts: string[] = [];
    if (oneofMethods.length > 0) {
      methodParts.push(indent(oneofMethods.join('\n\n')));
    }
    methodParts.push(
      indent(renderSource`
        private writeTo(writer: ProtoWriter): void {
          ${encoders}
        }`),
      indent(renderSource`
        encode(): collections.Uint8Array {
          const writer: ProtoWriter = new ProtoWriter();
          this.writeTo(writer);
          return writer.finish();
        }`),
      indent(renderSource`
        encodeBuffer(): ArrayBuffer {
          const writer: ProtoWriter = new ProtoWriter();
          this.writeTo(writer);
          return writer.finishBuffer();
        }`),
      indent(renderSource`
        static decode(bytes: Uint8Array | collections.Uint8Array): ${messageName} {
          return ${messageName}.mergeFrom(bytes, new ${messageName}());
        }`),
      indent(renderSource`
        static mergeFrom(bytes: Uint8Array | collections.Uint8Array, message: ${messageName}): ${messageName} {
          const reader: ProtoReader = new ProtoReader(bytes);
          while (!reader.isAtEnd()) {
            const tag: number = reader.readTag();
            switch (tag) {
              ${decoders}
              default:
                reader.skipField(Math.floor(tag / 8), tag & 0x07);
            }
          }
          return message;
        }`),
    );
    if (mapReaders.length > 0) {
      methodParts.push(indent(mapReaders));
    }
    if (this.json) {
      methodParts.push(
        indent(renderSource`
          traverse(visitor: ProtoVisitor): void {
            ${this.jsonCodec.renderTraversal(this.fields)}
          }`),
        indent(this.jsonCodec.renderToJson()),
        indent(this.jsonCodec.renderFromJson()),
        indent(this.jsonCodec.renderReadJson(this.fields)),
      );
    }

    const messageSource: string = renderSource`
      @Sendable
      export class ${messageName}${this.json ? ' implements ProtoMessage' : ''} {
      ${declarations.join('\n')}

      ${methodParts.join('\n\n')}
      }`;
    return messageSource;
  }

  private renderOneofMethods(oneofName: string, fields: FieldModel[]): string {
    const methods: string[] = [
      renderSource`
        get${toUpperCamel(oneofName)}Case(): number {
          return this.${oneofName}Case;
        }`,
    ];
    // setter 与 clear 都要先把同一 oneof 的所有成员复位，两处共用这段赋值。
    const resetMembers: string = fields
      .map((member): string => `this.${member.name} = ${member.defaultValue};`)
      .join('\n');

    for (const field of fields) {
      const methodName: string = toUpperCamel(field.name);
      const fallback: string = field.kind === 'message' ? 'undefined' : field.defaultValue;
      const setterType: string = field.kind === 'message' ? concreteType(field.arkType) : field.arkType;

      methods.push(
        renderSource`
          has${methodName}(): boolean {
            return this.${oneofName}Case === ${field.number};
          }`,
        renderSource`
          get${methodName}(): ${field.arkType} {
            return this.has${methodName}() ? this.${field.name} : ${fallback};
          }`,
        renderSource`
          set${methodName}(value: ${setterType}): void {
            ${resetMembers}
            this.${field.name} = value;
            this.${oneofName}Case = ${field.number};
          }`,
      );
    }

    methods.push(
      renderSource`
        clear${toUpperCamel(oneofName)}(): void {
          ${resetMembers}
          this.${oneofName}Case = 0;
        }`,
    );

    return methods.join('\n\n');
  }

  private renderOptionalMethods(oneofName: string, field: ValueFieldModel): string {
    const methodName: string = toUpperCamel(field.name);
    const fallback: string = field.kind === 'message' ? 'undefined' : field.defaultValue;
    const setterType: string = field.kind === 'message' ? concreteType(field.arkType) : field.arkType;
    return renderSource`
      has${methodName}(): boolean {
        return this.${oneofName}Case === ${field.number};
      }

      get${methodName}(): ${field.arkType} {
        return this.has${methodName}() ? this.${field.name} : ${fallback};
      }

      set${methodName}(value: ${setterType}): void {
        this.${field.name} = value;
        this.${oneofName}Case = ${field.number};
      }

      clear${methodName}(): void {
        this.${field.name} = ${field.defaultValue};
        this.${oneofName}Case = 0;
      }`;
  }

  private requireUniqueMemberNames(file: FileModel): void {
    const names: Map<string, string> = new Map();
    for (const field of this.fields) {
      const existing: string | undefined = names.get(field.name);
      if (existing !== undefined) {
        const conflicts: string[] = [existing, field.protoName].sort();
        throw new Error(
          `${file.fileName}: ${this.symbol.fullName}: ArkTS member ${field.name} conflicts between ${conflicts[0]} and ${conflicts[1]}`,
        );
      }
      names.set(field.name, field.protoName);
    }
  }
}

function concreteType(arkType: string): string {
  return arkType.endsWith(' | undefined') ? arkType.slice(0, -12) : arkType;
}
