import type { IFileDescriptorProto } from 'protobufjs/ext/descriptor/index.js';

/**
 * protoc 插件的输入输出契约与命令行选项。
 */
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
   * 是否生成 proto3 JSON 编解码 API。默认关闭，避免未使用方承担代码与 runtime 成本。
   */
  readonly json: boolean;

  /**
   * 本次生成文件的输出前缀；为空时直接落在输出根。
   */
  readonly outputPrefix: string;

  /**
   * 依赖协议的输出前缀，用于计算依赖 import；为空时沿用 outputPrefix，即与本次生成同目录。
   */
  readonly depPrefix: string;

  /**
   * 依赖协议的逻辑 proto 路径清单，由 dep_root 目录遍历得到。
   */
  readonly depFiles: ReadonlySet<string>;
}
