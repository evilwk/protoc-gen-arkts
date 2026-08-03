import { collections } from '@kit.ArkTS';
import {
  ProtoReader,
  ProtoWireType,
  ProtoWriter,
  appendProtoValue,
  getProtoMapKeys,
  getProtoMapValue,
  setProtoMapValue
} from 'protoc-gen-arkts-runtime';

@Entry
@Component
struct Index {
  @State message: string = this.verifyRuntime();

  private verifyRuntime(): string {
    const writer: ProtoWriter = new ProtoWriter();
    writer.writeTag(1, ProtoWireType.VARINT);
    writer.writeUInt32(42);

    const reader: ProtoReader = new ProtoReader(writer.finish());
    const tag: number = reader.readTag();
    const value: number = reader.readUInt32();

    const values: collections.Array<number> = new collections.Array<number>();
    appendProtoValue(values, value);
    const valueMap: collections.Map<string, number> = new collections.Map<string, number>();
    setProtoMapValue(valueMap, 'answer', values[0]);
    const keys: collections.Array<string> = getProtoMapKeys(valueMap);
    const mappedValue: number | undefined = getProtoMapValue(valueMap, keys[0]);

    return tag === 8 && mappedValue === 42 ? 'runtime HAR 验证通过' : 'runtime HAR 验证失败';
  }

  build() {
    RelativeContainer() {
      Text(this.message)
        .id('RuntimeHarStatus')
        .fontSize($r('app.float.page_text_font_size'))
        .fontWeight(FontWeight.Bold)
        .alignRules({
          center: { anchor: '__container__', align: VerticalAlign.Center },
          middle: { anchor: '__container__', align: HorizontalAlign.Center }
        })
    }
    .height('100%')
    .width('100%')
  }
}
