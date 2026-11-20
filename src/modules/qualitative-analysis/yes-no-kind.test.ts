import { describe, expect, it } from "vitest";
import { yesNoKindOf } from "./yes-no-kind";

const p = (es: string, en: string) => ({ es, en });

describe("yesNoKindOf", () => {
  it("tells the Santex yes/no questions apart", () => {
    expect(
      yesNoKindOf(
        p(
          "¿Cumplo con todas las políticas y procedimientos de seguridad de la información de la compañía?",
          "Am I following all Information Security Policies and Procedures of the Company?",
        ),
      ),
    ).toBe("security");
    expect(
      yesNoKindOf(
        p(
          "¿Hablo con esta persona con la frecuencia suficiente como para conocer sus necesidades?",
          "Do I speak with this employee frequently enough?",
        ),
      ),
    ).toBe("conversations");
    expect(
      yesNoKindOf(
        p(
          "¿Contribuyo con iniciativas de «Impacto social»? ¿Cómo?",
          'Do I contribute with initiatives related to "Social impact"? How?',
        ),
      ),
    ).toBe("impact");
    expect(yesNoKindOf(p("¿Te gusta el café?", "Coffee?"))).toBe("other");
  });
});
