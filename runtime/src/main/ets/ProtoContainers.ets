import { collections } from '@kit.ArkTS';

/**
 * 生成 codec 使用的 Sendable 容器操作。
 */
export class ProtoContainers {
  static append<T>(values: collections.Array<T>, value: T): void {
    try {
      values.push(value);
    } catch (error) {
      throw error as Error;
    }
  }

  static setMapValue<K, V>(values: collections.Map<K, V>, key: K, value: V): void {
    try {
      values.set(key, value);
    } catch (error) {
      throw error as Error;
    }
  }

  static mapKeys<K, V>(values: collections.Map<K, V>): collections.Array<K> {
    const result: collections.Array<K> = new collections.Array<K>();
    try {
      for (const key of values.keys()) {
        result.push(key);
      }
    } catch (error) {
      throw error as Error;
    }
    return result;
  }

  static mapValue<K, V>(values: collections.Map<K, V>, key: K): V | undefined {
    try {
      return values.get(key);
    } catch (error) {
      throw error as Error;
    }
  }
}
