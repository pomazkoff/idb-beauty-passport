import {
  type SurveyState,
  applyAnswer,
  buildProfile,
  completeCategory,
  emptyState,
  getBranchQuestions,
  getGender,
  markBaseCompleted,
} from "@idb/core";
import { survey } from "@idb/survey-config";
import { describe, expect, it } from "vitest";
import { restoreStateFromProfile } from "./ensi-restore.js";

function answer(state: SurveyState, key: string, codes: string[], skipped = false): SurveyState {
  const r = applyAnswer(survey, state, key, {
    optionCodes: codes,
    skipped,
    answeredAt: "2026-10-01T00:00:00.000Z",
  });
  if (!r.ok) throw new Error(r.error.message);
  return r.state;
}

function baseState(): SurveyState {
  let state = emptyState();
  state = answer(state, "gender", ["female"]);
  state = answer(state, "psycho1", ["E"]);
  state = answer(state, "psycho2", ["E"]);
  state = answer(state, "psycho3", ["P"]);
  state = answer(state, "category", ["face"]);
  return markBaseCompleted(state);
}

function passBranch(state: SurveyState, category: string): SurveyState {
  const gender = getGender(state)!;
  const qs = getBranchQuestions(survey, gender, category as never)!;
  let s = state;
  for (const q of qs) {
    if (q.type === "single") s = answer(s, q.key, [q.options[0]!.code]);
    else
      s = answer(
        s,
        q.key,
        q.options
          .filter((o) => !o.exclusive)
          .slice(0, 2)
          .map((o) => o.code),
      );
  }
  return completeCategory(s, category as never);
}

const profileOf = (state: SurveyState, customerId = "c1") =>
  buildProfile(survey, state, { customerId, revision: 2, updatedAt: "2026-10-01T00:00:00.000Z" });

describe("restoreStateFromProfile", () => {
  it("завершённая база открывается как result1", () => {
    const restored = restoreStateFromProfile(survey, profileOf(baseState()));
    expect(restored?.stage).toBe("result1");
    expect(restored?.state.baseCompleted).toBe(true);
    expect(restored?.state.completedCategories).toEqual([]);
    expect(restored?.state.answers.gender?.optionCodes).toEqual(["female"]);
    expect(restored?.state.answers.psycho3?.optionCodes).toEqual(["P"]);
  });

  it("завершённая категория открывается как result2", () => {
    const restored = restoreStateFromProfile(survey, profileOf(passBranch(baseState(), "face")));
    expect(restored?.stage).toBe("result2");
    expect(restored?.state.completedCategories).toEqual(["face"]);
    expect(restored?.state.answers.face_skin_type).toBeDefined();
  });

  it("незнакомый вопрос и чужой вариант пропускаются, база сохраняется", () => {
    const profile = profileOf(baseState());
    profile.answers.push(
      { stage: "base", question_key: "no_such", option_codes: ["x"], skipped: false },
      { stage: "base", question_key: "psycho1", option_codes: ["not-a-code"], skipped: false },
    );
    const restored = restoreStateFromProfile(survey, profile);
    expect(restored?.stage).toBe("result1");
    expect(restored?.state.answers.no_such).toBeUndefined();
    expect(restored?.state.answers.psycho1?.optionCodes).toEqual(["E"]);
  });

  it("неполная база, пустые ответы и чужая схема дают null", () => {
    const full = profileOf(baseState());
    expect(restoreStateFromProfile(survey, { ...full, answers: [] })).toBeNull();
    expect(
      restoreStateFromProfile(survey, {
        ...full,
        answers: full.answers.filter((a) => a.question_key === "gender"),
      }),
    ).toBeNull();
    expect(restoreStateFromProfile(survey, { ...full, schema_version: "0.9" as "1.0" })).toBeNull();
  });

  it("категория в списке без ответов ветки не становится result2", () => {
    const profile = profileOf(baseState());
    profile.completed_categories = ["face"];
    const restored = restoreStateFromProfile(survey, profile);
    expect(restored?.stage).toBe("result1");
    expect(restored?.state.completedCategories).toEqual([]);
  });
});
