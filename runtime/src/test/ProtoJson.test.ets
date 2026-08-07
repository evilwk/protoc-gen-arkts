import { collections } from '@kit.ArkTS';
import { describe, expect, it } from '@ohos/hypium';
import { FieldInfo } from '../main/ets/visitor/FieldInfo';
import { ProtoValueKind } from '../main/ets/visitor/ProtoValueKind';
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
