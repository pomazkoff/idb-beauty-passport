import { survey } from "../index.js";
import { validateSurvey } from "../validate.js";

const issues = validateSurvey(survey);
if (issues.length) {
  console.error(`✗ survey ${survey.version}: ${issues.length} замечаний`);
  for (const i of issues) console.error(`  ${i.path}: ${i.message}`);
  process.exit(1);
}
console.log(
  `✓ survey ${survey.version}: веток ${survey.branches.length}, виджетов ${survey.widgets.length}, вопросов ${
    survey.base.length + survey.branches.reduce((n, b) => n + b.questions.length, 0)
  }`,
);
