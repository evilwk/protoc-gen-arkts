/**
 * 将多行模板转换为生成源码。
 *
 * - 移除模板本身的公共缩进；
 * - 多行插值自动继承占位符所在列的缩进；
 * - 忽略模板首尾仅用于排版的空行。
 */
export function renderSource(strings: TemplateStringsArray, ...values: unknown[]): string {
  let rendered: string = strings[0] ?? '';
  for (let index: number = 0; index < values.length; index++) {
    const lineStart: number = rendered.lastIndexOf('\n') + 1;
    const linePrefix: string = rendered.slice(lineStart);
    const indentation: string = /^[ \t]*/.exec(linePrefix)?.[0] ?? '';

    const value: string = String(values[index]);
    rendered += value.split('\n').map(
      (line, lineIndex): string => lineIndex === 0 || line.length === 0
        ? line
        : `${indentation}${line}`
    ).join('\n');

    rendered += strings[index + 1] ?? '';
  }

  const lines: string[] = rendered
    .replace(/^\r?\n/, '')
    .replace(/\r?\n[ \t]*$/, '')
    .split(/\r?\n/);

  const indents: number[] = lines
    .filter((line): boolean => line.trim().length > 0)
    .map((line): number => /^[ \t]*/.exec(line)?.[0].length ?? 0);

  const commonIndent: number = indents.length === 0 ? 0 : Math.min(...indents);
  return lines.map((line): string => line.slice(commonIndent)).join('\n');
}
