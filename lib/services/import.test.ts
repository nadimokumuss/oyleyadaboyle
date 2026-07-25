import { describe, it, expect } from "vitest";
import { normalizeNumber } from "./import";

describe("normalizeNumber — CSV sayı ayrıştırma", () => {
  it("Türkçe biçimi çözer", () => {
    expect(normalizeNumber("1.234.567,89")).toBe("1234567.89");
  });

  it("İngilizce biçimi çözer", () => {
    expect(normalizeNumber("1,234,567.89")).toBe("1234567.89");
  });

  it("ayraçsız sayıyı olduğu gibi bırakır", () => {
    expect(normalizeNumber("1234567.89")).toBe("1234567.89");
    expect(normalizeNumber("42")).toBe("42");
  });

  it("sadece virgüllü sayıyı ondalık kabul eder", () => {
    expect(normalizeNumber("42,5")).toBe("42.5");
  });

  it("negatif sayıyı korur", () => {
    expect(normalizeNumber("-1.234,56")).toBe("-1234.56");
  });

  it("boş ve geçersiz girdide boş döner", () => {
    expect(normalizeNumber("")).toBe("");
    expect(normalizeNumber("   ")).toBe("");
    expect(normalizeNumber("abc")).toBe("");
    expect(normalizeNumber("1.2.3,4,5")).toBe("");
  });

  it("çok büyük sayıda hassasiyet kaybetmez", () => {
    expect(normalizeNumber("10.000.000,07")).toBe("10000000.07");
  });
});
