import { survey } from "@idb/survey-config";
import { describe, expect, it } from "vitest";
import { bumpVersion, frozenOf, nextOptionCode, nextQuestionKey, nextWidgetCode, setIn } from "./model.js";

describe("model", () => {
  it("setIn не мутирует исходник", () => {
    const next = setIn(survey, ["screens", "intro", "lead"], "x");
    expect(next.screens.intro.lead).toBe("x");
    expect(survey.screens.intro.lead).not.toBe("x");
    expect(next.base).toBe(survey.base); // незатронутые ветки переиспользуются
  });

  it("frozenOf собирает ключи, коды и виджеты опубликованной версии", () => {
    const f = frozenOf(survey);
    expect(f.questions.has("face_skin_type")).toBe(true);
    expect(f.options.get("psycho1")?.has("M")).toBe(true);
    expect(f.options.get("face_skin_type")?.has("combination")).toBe(true);
    expect(f.widgets.has("community")).toBe(true);
    expect(frozenOf(null).questions.size).toBe(0);
  });

  it("коды генерируются транслитом и уникальны", () => {
    const q = survey.branches[0]!.questions[0]!; // face_skin_type: oily, combination, dry, normal
    expect(nextOptionCode("Очень сухая, шелушится", q)).toBe("ochen_suhaya_shelushitsya");
    expect(nextOptionCode("Dry", q)).toBe("dry_2");
    expect(nextQuestionKey("face", "Чувствительность", survey, "female")).toBe("face_chuvstvitelnost");
    expect(nextQuestionKey("face", "Тип кожи", survey, "female")).toBe("face_tip_kozhi");
    expect(nextWidgetCode("Общение с комьюнити", survey)).toBe("obschenie_s_komyuniti");
  });

  it("bumpVersion", () => {
    expect(bumpVersion("1.0.0")).toBe("1.1.0");
    expect(bumpVersion("1.2.3", "patch")).toBe("1.2.4");
    expect(bumpVersion("1.2.3", "major")).toBe("2.0.0");
  });
});
