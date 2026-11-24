const accessPoint = String.raw`(?:gate|door|entry|entrance|access|alarm|keypad|garage|intercom|portao|porta|entrada|acesso|alarme|teclado|garagem|campainha|puerta|porton|acceso|alarma|cerradura|garaje)`;
const keySafe = String.raw`(?:key[ -]?(?:safe|box)|lock[ -]?box|(?:caixa|cofre)\s+(?:de|das)\s+chaves|(?:caja|cajetin)\s+de\s+(?:las\s+)?llaves)`;
const secretWord = String.raw`(?:pin|pass[ -]?code|password|senha|palavra[ -]passe|contrasena)`;
const codeWord = String.raw`(?:code|codigo|clave|${secretWord})`;
const qualifier = String.raw`(?:for|to|of|de(?:l|\s+(?:la|las|los))?|do|da|dos|das|para(?:\s+(?:o|a|el|la))?)`;
const label = String.raw`\b(?:${secretWord}|${keySafe}|(?:${accessPoint}|${keySafe})[\s-]+${codeWord}|${codeWord}\s+${qualifier}\s+(?:${accessPoint}|${keySafe}))\b`;
const separator = String.raw`\s*(?:(?:is|e|es)\b\s*)?(?:[:=–—-]\s*)?(?:[#*]\s*)?`;
const endOfNumber = String.raw`(?![\p{L}\p{N}]|[:./-]\p{Nd})`;
const pin = String.raw`(?:\p{Nd}{2,8}|\p{Nd}{2,4}[ -]\p{Nd}{2,4}|(?:\p{Nd}[ -]){3,7}\p{Nd})${endOfNumber}`;

const labelledPin = new RegExp(String.raw`${label}${separator}${pin}|(?:^|[^\p{L}\p{N}:./-])${pin}\s*(?:[:=–—-]\s*|(?:is|e|es)\s+(?:(?:the|o|a|el|la)\s+)?)?${label}`, "iu");
// Generic labels are too ambiguous elsewhere (postal code, Gate 2, Door Street).
const shortLabel = new RegExp(String.raw`(?:^|[\n;])\s*${codeWord}\s*[:=#]\s*${pin}|\b${accessPoint}\s*[:=#]\s*\p{Nd}{3,8}${endOfNumber}|(?:^|[\n;])\s*${accessPoint}\s+\p{Nd}{4,8}\s*[.!]?(?=$|[\n;])`, "iu");
const keypadSequence = /(?:^|[^\p{L}\p{N}])(?:\*\p{Nd}{2,8}#?|\p{Nd}{3,8}#)(?![\p{L}\p{N}])|^\s*#\p{Nd}{3,8}\s*$/u;

const declarationLabel = String.raw`(?:${label}|\b(?:code|codigo|clave|alarm|alarme|alarma)\b)`;
const statementStart = String.raw`(?:^|[\n;,.]|\b(?:use|enter|type|digite|introduza|introduce|utilize|usa)\s+)`;
const valueAssignment = String.raw`(?:\s*[:=–—-]\s*\S|\s+(?:is|e|es)\b\s+\S|\s*[*#]\S*)`;
// A label at the start of an instruction, or an explicit assignment anywhere,
// signals a supplied value. A passing reference to the handoff code does not.
const labelledValue = new RegExp(String.raw`${declarationLabel}${valueAssignment}|${statementStart}\s*(?:(?:the|o|a|el|la)\s+)?${declarationLabel}[^\S\r\n]+\S`, "iu");
const explicitValue = new RegExp(String.raw`${label}${valueAssignment}`, "iu");
const digitRun = /(?:^|[^\p{L}\p{N}])\p{Nd}{4,}(?![\p{L}\p{N}])/u;
const barePin = /^\s*(?:\p{Nd}[\s-]?){2,}\p{Nd}\s*[.!]?\s*$/u;

/** Only arrival notes reject unlabelled numbers; prose requires a credential label. */
export function looksLikeAccessCode(text: string, field: "arrival" | "place-identity" | "label-only" = "arrival"): boolean {
  const plain = text.normalize("NFKD").replace(/[\p{M}\p{Cf}]/gu, "");
  if (labelledPin.test(plain)) return true;
  if (field === "label-only") return explicitValue.test(plain);
  return shortLabel.test(plain) || keypadSequence.test(plain)
    || (field === "arrival" && (digitRun.test(plain) || barePin.test(plain) || labelledValue.test(plain)));
}
