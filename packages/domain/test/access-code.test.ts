import { expect, test } from "bun:test";
import { looksLikeAccessCode } from "../src/access-code";

test.each([
  ["en", "4827", true],
  ["en", "Meet at 9:00; 4827", true],
  ["en", "Gate code is #4827", true],
  ["en", "Side door PIN: 6 4 2 8", true],
  ["en", "The keypad accepts *2417#", true],
  ["en", "4827 is the key safe code", true],
  ["en", "Code RiverBlue", true],
  ["en", "Meet at the side gate; the password is blue-lantern", true],
  ["en", "Please use key safe Blue Sky", true],
  ["en", "Alarm: !!!", true],
  ["en", "Use gate 3, on the 2nd floor after 9:00.", false],
  ["en", "Meet by the door after 09:00 or at 14:30.", false],
  ["en", "I'll tell you the gate code when you arrive.", false],
  ["pt-PT", "１２３４", true],
  ["pt-PT", "6 4 2 8", true],
  ["pt-PT", "O código do portão é 6428", true],
  ["pt-PT", "Caixa das chaves: 42 83", true],
  ["pt-PT", "PIN do alarme: ٨٣٠٢", true],
  ["pt-PT", "Código: Azul-Verde", true],
  ["pt-PT", "Senha Jardim", true],
  ["pt-PT", "A palavra-passe é solNascente", true],
  ["pt-PT", "Portão 3, 2.º andar às 9:00.", false],
  ["pt-PT", "Digo-lhe o código do portão quando chegar.", false],
  ["es", " 8302 ", true],
  ["es", "La clave de la puerta es 5283", true],
  ["es", "Portón 2468", true],
  ["es", "Código de la caja de llaves: 7248", true],
  ["es", "La contraseña es cielo azul", true],
  ["es", "Clave lunaNueva", true],
  ["es", "Alarma=la-luna", true],
  ["es", "Puerta 3, 2.º piso, después de las 9:00.", false],
  ["es", "Te diré la clave cuando llegues.", false],
] as const)("%s classifies arrival text %s", (_locale, text, secret) => {
  expect(looksLikeAccessCode(text)).toBe(secret);
});

test.each([
  "12 Praça do Mar, 2750-642 Cascais",
  "1234 Gate Street, apt #2201",
  "Calle Portón 1234",
  "Postal code: 28290",
])("address fields still allow ordinary numbers: %s", (address) => {
  expect(looksLikeAccessCode(address, "place-identity")).toBe(false);
  expect(looksLikeAccessCode(address)).toBe(true);
});
