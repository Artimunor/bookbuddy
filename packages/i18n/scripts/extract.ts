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

// These app prop names carry typed catalog keys. Only count values that are actual
// catalog keys: unrelated props with the same spelling are not translation calls.
const messageKeyProps = { actionLabelKey: true, titleKey: true, labelKey: true };

function messageKeyValue(node: ts.Node): ts.Expression | undefined {
  if (ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))
    && Object.hasOwn(messageKeyProps, node.name.text)) return node.initializer;
  if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && Object.hasOwn(messageKeyProps, node.name.text)) {
    const value = node.initializer;
    return value && (ts.isJsxExpression(value) ? value.expression : value);
  }
  return undefined;
}

function recordMessageKeyValue(value: ts.Expression, known: ReadonlySet<string>, used: Set<string>): void {
  const key = unwrap(value);
  if (ts.isStringLiteralLike(key)) {
    if (known.has(key.text)) used.add(key.text);
  } else if (ts.isConditionalExpression(key)) {
    recordMessageKeyValue(key.whenTrue, known, used);
    recordMessageKeyValue(key.whenFalse, known, used);
  }
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
      const value = messageKeyValue(node);
      if (value) recordMessageKeyValue(value, known, used);
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return { errors, unused: [...known].filter((key) => !used.has(key)).sort() };
}
