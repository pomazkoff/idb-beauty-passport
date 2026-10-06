/**
 * Сид для демо: три пользователя — demo-e (женщина, E, лицо пройдено),
 * demo-p (мужчина, P, только база), demo-m (женщина, M, две категории).
 */
import { getBranchQuestions } from "@idb/core";
import { createDb, loadDotenv } from "@idb/db";
import { survey } from "@idb/survey-config";
import { registerSurveyVersion } from "./app.js";
import { SessionService } from "./services/session.service.js";

loadDotenv();

const { db, close } = createDb();
await registerSurveyVersion(db, survey);
const svc = new SessionService(db, survey);

async function run(
  customer: string,
  gender: "female" | "male",
  votes: string[],
  category: string,
  passports: string[],
) {
  await svc.reset(customer);
  await svc.answer(customer, "gender", { optionCodes: [gender], skipped: false });
  await svc.answer(customer, "psycho1", { optionCodes: [votes[0]!], skipped: false });
  await svc.answer(customer, "psycho2", { optionCodes: [votes[1]!], skipped: false });
  await svc.answer(customer, "psycho3", { optionCodes: [votes[2]!], skipped: false });
  await svc.answer(customer, "category", { optionCodes: [category], skipped: false });
  let p = await svc.completeBase(customer);
  for (const cat of passports) {
    await svc.startPassport(customer, cat as never);
    for (const q of getBranchQuestions(survey, gender, cat as never)!) {
      const codes =
        q.type === "single"
          ? [q.options[0]!.code]
          : q.options
              .filter((o) => !o.exclusive)
              .slice(0, 2)
              .map((o) => o.code);
      await svc.answer(customer, q.key, { optionCodes: codes, skipped: false });
    }
    p = await svc.completePassport(customer, cat as never);
  }
  console.log(
    `✓ ${customer}: ${p.psychotype.name}, ${p.completeness_pct}%, категории: ${p.completed_categories.join(", ") || "—"}`,
  );
}

await run("demo-e", "female", ["E", "E", "P"], "face", ["face"]);
await run("demo-p", "male", ["P", "P", "L"], "hair", []);
await run("demo-m", "female", ["E", "P", "L"], "makeup", ["makeup", "perfume"]);
await close();
