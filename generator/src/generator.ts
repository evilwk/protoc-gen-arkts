import { DescriptorModel } from './model/descriptor-model.js';
import type {
  FileModel,
  GeneratedFile,
  GeneratorRequest,
  PluginOptions
} from './model/types.js';
import { parseOptions } from './options.js';
import { ArkTSFileRenderer } from './rendering/file-renderer.js';

/**
 * 编排一次 CodeGeneratorRequest 的建模、排序与文件生成。
 */
export class ArkTSGenerator {

  public generate(request: GeneratorRequest): GeneratedFile[] {
    if (request.filesToGenerate.length === 0) {
      throw new Error('CodeGeneratorRequest does not contain file_to_generate');
    }

    const options: PluginOptions = parseOptions(request.parameter);
    const model: DescriptorModel = DescriptorModel.build(
      request.protoFiles,
      request.filesToGenerate,
      options
    );

    return [...request.filesToGenerate].sort().map((fileName: string): GeneratedFile => {
      const file: FileModel = model.requireFile(fileName);
      return {
        name: model.requireOutputName(file, fileName),
        content: new ArkTSFileRenderer(file, model, options).render()
      };
    });
  }

}
