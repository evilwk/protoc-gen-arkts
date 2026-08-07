/**
 * 严格 JSON tokenizer 产出的 token 类型。
 */
export const enum JsonToken {
  BEGIN_OBJECT,
  END_OBJECT,
  BEGIN_ARRAY,
  END_ARRAY,
  STRING,
  NUMBER,
  BOOL,
  NULL
}
