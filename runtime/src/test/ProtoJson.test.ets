import { collections } from '@kit.ArkTS';
import { describe, expect, it } from '@ohos/hypium';
import { FieldInfo } from '../main/ets/visitor/FieldInfo';
import { ProtoValueKind } from '../main/ets/visitor/ProtoValueKind';
import { ProtoJsonMessage, ProtoVisitor } from '../main/ets/visitor/ProtoVisitor';
import {
  JsonEncodingVisitor
} from '../main/ets/json/JsonEncodingVisitor';
import { JsonReader } from '../main/ets/json/JsonReader';
import { JsonToken } from '../main/ets/json/JsonToken';
import { JsonWriter } from '../main/ets/json/JsonWriter';
import { ProtoJson } from '../main/ets/json/ProtoJson';

function didThrow(action: () => void): boolean {
  try {
    action();
    return false;
  } catch (_error) {
    return true;
  }
}

@Sendable
class JsonNestedMessage implements ProtoJsonMessage {
  encode(): collections.Uint8Array {
    return new collections.Uint8Array(0);
  }

  encodeBuffer(): ArrayBuffer {
    return new ArrayBuffer(0);
  }

  traverse(visitor: ProtoVisitor): void {
    visitor.visitString('nested', new FieldInfo(1, 'name'));
  }

  toJson(): string {
    return '{"name":"nested"}';
  }
}

export default function protoJsonTest(): void {
  describe('ProtoJsonTest', () => {
    it('tokenizesNestedValuesAndRejectsMalformedInput', 0, () => {
      const reader: JsonReader = new JsonReader('{"known":1,"skip":{"nested":[true,null,"x"]}}');
      reader.beginObject();
      expect(reader.hasMoreMembers()).assertTrue();
      expect(reader.readKey()).assertEqual('known');
      expect(reader.peek()).assertEqual(JsonToken.NUMBER);
      expect(reader.readNumberAsNumber()).assertEqual(1);
      expect(reader.hasMoreMembers()).assertTrue();
      expect(reader.readKey()).assertEqual('skip');
      reader.skipValue();
      expect(reader.hasMoreMembers()).assertFalse();
      reader.endObject();
      reader.requireEndOfInput();

      expect(didThrow((): void => new JsonReader('{"a":1,}').skipValue())).assertTrue();
      expect(didThrow((): void => new JsonReader('{"a":1,"a":2}').skipValue())).assertTrue();
      expect(didThrow((): void => new JsonReader('NaN').skipValue())).assertTrue();
    });

    it('preservesExactIntegerBoundaries', 0, () => {
      expect(ProtoJson.readInt64(new JsonReader('"9223372036854775807"')) ===
        9223372036854775807n).assertTrue();
      expect(ProtoJson.readInt64(new JsonReader('-9223372036854775808')) ===
        -9223372036854775808n).assertTrue();
      expect(ProtoJson.readInt64(new JsonReader('9.223372036854775807e18')) ===
        9223372036854775807n).assertTrue();
      expect(didThrow((): void => {
        ProtoJson.readInt64(new JsonReader('9223372036854775808'));
      })).assertTrue();
    });

    it('normalizesIntegralExponentsWithoutExpandingOutOfRangeValues', 0, () => {
      expect(ProtoJson.readInt64(new JsonReader('0e-2')) === 0n).assertTrue();
      expect(ProtoJson.readInt64(new JsonReader('"-0.000e-100000"')) === 0n).assertTrue();
      expect(ProtoJson.readInt64(new JsonReader('1.000e3')) === 1000n).assertTrue();
      expect(didThrow((): void => {
        ProtoJson.readInt64(new JsonReader('1e100000'));
      })).assertTrue();
      expect(didThrow((): void => {
        ProtoJson.parseUInt64MapKey('100000000000000000000');
      })).assertTrue();
    });

    it('roundTripsStandardAndUrlSafeBase64', 0, () => {
      const bytes: collections.Uint8Array = collections.Uint8Array.from([0xfb, 0xff, 0xef]);
      expect(ProtoJson.encodeBase64(bytes)).assertEqual('+//v');
      const decoded: collections.Uint8Array = ProtoJson.decodeBase64('-__v');
      expect(decoded.length).assertEqual(3);
      expect(decoded[0]).assertEqual(0xfb);
      expect(decoded[1]).assertEqual(0xff);
      expect(decoded[2]).assertEqual(0xef);
      expect(didThrow((): void => {
        ProtoJson.decodeBase64('a');
      })).assertTrue();
    });

    it('runsGeneratedJsonContainerFrameworks', 0, () => {
      const nullReader: JsonReader = new JsonReader('null');
      expect(ProtoJson.skipNull(nullReader)).assertTrue();
      nullReader.requireEndOfInput();
      expect(ProtoJson.skipNull(new JsonReader('1'))).assertFalse();
      const seenFields: Set<number> = new Set<number>();
      expect(ProtoJson.skipNullField(new JsonReader('1'), seenFields, 1)).assertFalse();
      expect(didThrow((): void => {
        ProtoJson.skipNullField(new JsonReader('1'), seenFields, 1);
      })).assertTrue();

      const oneofCases: number[] = [0];
      ProtoJson.requireOneof(oneofCases, 0, 3, 'choice');
      expect(oneofCases[0]).assertEqual(3);
      expect(didThrow((): void => ProtoJson.requireOneof(oneofCases, 0, 4, 'choice'))).assertTrue();

      const repeated: collections.Array<number> = new collections.Array<number>();
      const repeatedReader: JsonReader = new JsonReader('[1,2]');
      ProtoJson.readRepeated<number>(repeatedReader,
        (value: number): void => repeated.push(value),
        (): number => ProtoJson.readInt32(repeatedReader));
      expect(repeated.length).assertEqual(2);
      expect(repeated[1]).assertEqual(2);

      const enumValues: collections.Array<number> = new collections.Array<number>();
      const enumReader: JsonReader = new JsonReader('[1,"UNKNOWN",2]');
      ProtoJson.readRepeatedEnum(enumReader,
        (value: number): void => enumValues.push(value),
        (): number | undefined => {
          if (ProtoJson.isString(enumReader)) {
            enumReader.readString();
            return undefined;
          }
          return ProtoJson.readInt32(enumReader);
        });
      expect(enumValues.length).assertEqual(2);
      expect(enumValues[0]).assertEqual(1);
      expect(enumValues[1]).assertEqual(2);

      const mapped: collections.Map<number, number> = new collections.Map<number, number>();
      const mapReader: JsonReader = new JsonReader('{"1":7,"2":8}');
      let mapValueIndex: number = 0;
      ProtoJson.readMap<number, number>(mapReader,
        (key: number, value: number): void => mapped.set(key, value),
        (text: string): number => Number(text),
        (): number | undefined => {
          mapValueIndex++;
          const value: number = ProtoJson.readInt32(mapReader);
          return mapValueIndex === 1 ? value : undefined;
        });
      expect(mapped.size).assertEqual(1);
      expect(mapped.get(1)).assertEqual(7);
    });

    it('runsGeneratedJsonTraversalFrameworks', 0, () => {
      const writer: JsonWriter = new JsonWriter();
      const visitor: JsonEncodingVisitor = new JsonEncodingVisitor(writer);
      ProtoJson.traverseNumberField(visitor, false, 0, ProtoValueKind.INT32, 9, 'omitted');
      ProtoJson.traverseNumberField(visitor, true, 5, ProtoValueKind.INT32, 4, 'count');
      const values: collections.Array<string> = new collections.Array<string>('a', 'b');
      ProtoJson.traverseRepeated<string>(visitor, values, 1, 'values', undefined,
        (value: string, field: FieldInfo): void => visitor.visitString(value, field));

      const labels: collections.Map<string, number> = new collections.Map<string, number>();
      labels.set('x', 7);
      ProtoJson.traverseMap<string, number>(visitor, labels, 2, 'labels', undefined,
        (key: string, value: number, field: FieldInfo): void => {
          visitor.mapKey(key);
          visitor.visitNumber(value, ProtoValueKind.INT32, field);
        });
      ProtoJson.traverseMessage(visitor, new FieldInfo(3, 'child'), new JsonNestedMessage());

      expect(writer.finish()).assertEqual(
        '{"count":5,"values":["a","b"],"labels":{"x":7},"child":{"name":"nested"}}'
      );
    });

    it('writesCanonicalScalarAndContainerShapes', 0, () => {
      const scalar: FieldInfo = new FieldInfo(1, 'count');
      const values: FieldInfo = new FieldInfo(2, 'values');
      const labels: FieldInfo = new FieldInfo(3, 'labels');
      const mode: FieldInfo = new FieldInfo(4, 'mode');
      const writer: JsonWriter = new JsonWriter();
      const visitor: JsonEncodingVisitor = new JsonEncodingVisitor(writer);

      visitor.visitBigInt(9n, ProtoValueKind.INT64, scalar);
      visitor.beginRepeated(values);
      visitor.visitString('a', values);
      visitor.visitString('b', values);
      visitor.endRepeated(values);
      visitor.beginMap(labels);
      visitor.mapKey('1');
      visitor.visitBool(true, labels);
      visitor.endMap(labels);
      visitor.visitEnum(1, 'READY', mode);

      expect(writer.finish()).assertEqual(
        '{"count":"9","values":["a","b"],"labels":{"1":true},"mode":"READY"}'
      );
    });
  });
}
