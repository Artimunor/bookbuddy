import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import ts from "typescript";

function unwrap(node: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)
    || ts.isNonNullExpression(node) || ts.isTypeAssertionExpression(node)) node = node.expression;
  return node;
}

function translationCall(node: ts.CallExpression): boolean {
  const target = unwrap(node.expression);
  if (ts.isIdentifier(target)) return target.text === "t";
  if (ts.isPropertyAccessExpression(target)) return target.name.text === "t";
  return ts.isElementAccessExpression(target) && ts.isStringLiteralLike(target.argumentExpression)
    && target.argumentExpression.text === "t";
}

export async function extractKeys(apps: string, known: ReadonlySet<string>): Promise<{ errors: string[]; unused: string[] }> {
  const paths = ts.sys.readDirectory(apps, [".ts", ".tsx"], ["**/node_modules", "**/dist", "**/build", "**/coverage", "**/.*/**"], ["**/*"]).sort();
  const used = new Set<string>();
  const errors: string[] = [];
  for (const path of paths) {
    const source = ts.createSourceFile(path, await readFile(path, "utf8"), ts.ScriptTarget.Latest);
    function visit(node: ts.Node): void {
      if (ts.isCallExpression(node) && translationCall(node)) {
        const key = node.arguments[0] && unwrap(node.arguments[0]);
        const { line, character } = source.getLineAndCharacterOfPosition((key ?? node).getStart(source));
        const at = `${relative(apps, path)}:${line + 1}:${character + 1}`;
        if (!key || !ts.isStringLiteralLike(key)) errors.push(`${at}: t() requires a literal message key`);
        else if (!known.has(key.text)) errors.push(`${at}: unknown message key ${JSON.stringify(key.text)}`);
        else used.add(key.text);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return { errors, unused: [...known].filter((key) => !used.has(key)).sort() };
}
