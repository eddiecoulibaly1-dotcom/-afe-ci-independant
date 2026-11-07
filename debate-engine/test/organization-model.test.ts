import test from "node:test";
import assert from "node:assert/strict";
import {
  DEPARTMENT_CATALOG,
  EXECUTIVE_OFFICES,
  getDepartmentOffice,
  matchDepartments,
  validateOrganizationCatalog
} from "../src/organization-model.js";

test("the initial organization catalog contains eight distinct functional departments", () => {
  assert.equal(DEPARTMENT_CATALOG.length, 8);
  assert.equal(new Set(DEPARTMENT_CATALOG.map(item => item.code)).size, 8);
  assert.deepEqual(validateOrganizationCatalog(), []);
});

test("the office hierarchy separates the human President, AI General Manager and departments", () => {
  const president = EXECUTIVE_OFFICES.find(office => office.id === "president-office");
  const generalManager = EXECUTIVE_OFFICES.find(office => office.id === "general-management-office");
  assert.equal(president?.ownerRole, "human_owner");
  assert.equal(generalManager?.ownerRole, "general_manager");
  assert.equal(generalManager?.parentId, president?.id);
  assert.equal(EXECUTIVE_OFFICES.filter(office => office.kind === "department").length, 8);
});

test("each department has its own digital office without inventing a separate runtime", () => {
  for (const department of DEPARTMENT_CATALOG) {
    const office = getDepartmentOffice(department.code);
    assert.ok(office);
    assert.equal(office?.departmentCode, department.code);
    assert.equal(office?.parentId, "general-management-office");
  }
});

test("mission capability matching returns only departments with relevant skills", () => {
  const matches = matchDepartments([
    { capability: "financial_modeling", required: true, reason: "Build the business case" },
    { capability: "market_research", required: true, reason: "Estimate demand" },
    { capability: "risk_assessment", required: false, reason: "Stress-test the investment" }
  ]);
  assert.deepEqual(matches.map(item => item.department.code), ["COM", "FIN", "RSK"]);
  assert.ok(matches.every(item => item.score > 0));
});

test("the independent audit function is explicitly marked as independent", () => {
  const audit = DEPARTMENT_CATALOG.find(item => item.code === "AUD");
  assert.equal(audit?.independentReview, true);
  assert.ok(audit?.capabilities.includes("independent_review"));
});
