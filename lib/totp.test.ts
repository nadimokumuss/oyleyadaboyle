import { describe, it, expect } from "vitest";
import {
  base32Encode, base32Decode, generateSecret, generateCode, verifyCode,
  currentCounter, otpauthUrl, generateRecoveryCodes, consumeRecoveryCode,
  hashRecoveryCode,
} from "./totp";

describe("base32", () => {
  it("gidiş dönüş kayıpsız", () => {
    const buf = Buffer.from("merhaba dünya", "utf8");
    expect(base32Decode(base32Encode(buf)).toString("utf8")).toBe("merhaba dünya");
  });

  it("RFC 4648 örneğiyle uyumlu", () => {
    // "foobar" → MZXW6YTBOI
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
  });

  it("geçersiz karakteri reddeder", () => {
    expect(() => base32Decode("MZXW6YTB01")).toThrow(/base32/i);
  });

  it("boşluk ve dolgu karakterlerini yok sayar", () => {
    const secret = generateSecret();
    expect(base32Decode(`${secret} `).equals(base32Decode(secret))).toBe(true);
  });
});

describe("generateSecret", () => {
  it("160 bitlik anahtar üretir (32 base32 karakteri)", () => {
    expect(generateSecret()).toHaveLength(32);
  });

  it("her çağrıda farklı", () => {
    expect(generateSecret()).not.toBe(generateSecret());
  });
});

describe("generateCode — RFC 6238 test vektörleri", () => {
  // RFC 6238 Ek B: "12345678901234567890" anahtarı, SHA1
  const rfcSecret = base32Encode(Buffer.from("12345678901234567890"));

  it("T=59 için 94287082", () => {
    // Counter = floor(59/30) = 1
    expect(generateCode(rfcSecret, 1)).toBe("287082");
  });

  it("T=1111111109 için 07081804", () => {
    expect(generateCode(rfcSecret, Math.floor(1111111109 / 30))).toBe("081804");
  });

  it("T=1234567890 için 89005924", () => {
    expect(generateCode(rfcSecret, Math.floor(1234567890 / 30))).toBe("005924");
  });

  it("her zaman 6 haneli", () => {
    const s = generateSecret();
    for (let i = 0; i < 50; i++) {
      expect(generateCode(s, i)).toMatch(/^\d{6}$/);
    }
  });
});

describe("verifyCode", () => {
  const secret = generateSecret();
  const now = new Date("2026-07-25T12:00:00Z");

  it("doğru kodu kabul eder", () => {
    const code = generateCode(secret, currentCounter(now));
    expect(verifyCode(secret, code, now)).toBe(true);
  });

  it("yanlış kodu reddeder", () => {
    expect(verifyCode(secret, "000000", now)).toBe(false);
  });

  it("bir önceki pencereyi kabul eder (saat kayması toleransı)", () => {
    const code = generateCode(secret, currentCounter(now) - 1);
    expect(verifyCode(secret, code, now)).toBe(true);
  });

  it("bir sonraki pencereyi kabul eder", () => {
    const code = generateCode(secret, currentCounter(now) + 1);
    expect(verifyCode(secret, code, now)).toBe(true);
  });

  it("iki pencere öncesini REDDEDER — tolerans sınırlı", () => {
    const code = generateCode(secret, currentCounter(now) - 3);
    expect(verifyCode(secret, code, now)).toBe(false);
  });

  it("boşluklu girdiyi temizler", () => {
    const code = generateCode(secret, currentCounter(now));
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
    expect(verifyCode(secret, spaced, now)).toBe(true);
  });

  it("biçimsiz girdiyi reddeder", () => {
    expect(verifyCode(secret, "12345", now)).toBe(false);
    expect(verifyCode(secret, "abcdef", now)).toBe(false);
    expect(verifyCode(secret, "", now)).toBe(false);
    expect(verifyCode(secret, "1234567", now)).toBe(false);
  });

  it("başka bir anahtarın kodunu kabul etmez", () => {
    const other = generateSecret();
    const code = generateCode(other, currentCounter(now));
    expect(verifyCode(secret, code, now)).toBe(false);
  });
});

describe("otpauthUrl", () => {
  it("standart biçimde URI üretir", () => {
    const url = otpauthUrl("JBSWY3DPEHPK3PXP", "test@ornek.com");
    expect(url).toMatch(/^otpauth:\/\/totp\//);
    expect(url).toContain("secret=JBSWY3DPEHPK3PXP");
    expect(url).toContain("digits=6");
    expect(url).toContain("period=30");
  });

  it("etiketi URL güvenli kodlar", () => {
    expect(otpauthUrl("ABC", "a b@c.com")).toContain("a%20b%40c.com");
  });
});

describe("kurtarma kodları", () => {
  it("istenen sayıda kod üretir", () => {
    const { plain, hashed } = generateRecoveryCodes(8);
    expect(plain).toHaveLength(8);
    expect(hashed).toHaveLength(8);
  });

  it("okunabilir biçimde (4-4)", () => {
    const { plain } = generateRecoveryCodes(3);
    for (const c of plain) expect(c).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
  });

  it("kodlar birbirinden farklı", () => {
    const { plain } = generateRecoveryCodes(8);
    expect(new Set(plain).size).toBe(8);
  });

  it("düz metin saklanmaz — hash farklı", () => {
    const { plain, hashed } = generateRecoveryCodes(1);
    expect(hashed[0]).not.toBe(plain[0]);
    expect(hashed[0]).toHaveLength(64);
  });

  it("geçerli kod kabul edilir ve listeden çıkar", () => {
    const { plain, hashed } = generateRecoveryCodes(4);
    const r = consumeRecoveryCode(plain[1], hashed);
    expect(r.valid).toBe(true);
    expect(r.remaining).toHaveLength(3);
  });

  it("aynı kod ikinci kez çalışmaz", () => {
    const { plain, hashed } = generateRecoveryCodes(4);
    const first = consumeRecoveryCode(plain[0], hashed);
    const second = consumeRecoveryCode(plain[0], first.remaining);
    expect(first.valid).toBe(true);
    expect(second.valid).toBe(false);
  });

  it("yanlış kod reddedilir, liste değişmez", () => {
    const { hashed } = generateRecoveryCodes(4);
    const r = consumeRecoveryCode("XXXX-YYYY", hashed);
    expect(r.valid).toBe(false);
    expect(r.remaining).toHaveLength(4);
  });

  it("büyük/küçük harf ve boşluk toleransı", () => {
    const { plain, hashed } = generateRecoveryCodes(2);
    const messy = ` ${plain[0].toLowerCase()} `;
    expect(consumeRecoveryCode(messy, hashed).valid).toBe(true);
  });

  it("aynı koddan aynı hash üretilir", () => {
    expect(hashRecoveryCode("ABCD-1234")).toBe(hashRecoveryCode("abcd-1234"));
  });
});
