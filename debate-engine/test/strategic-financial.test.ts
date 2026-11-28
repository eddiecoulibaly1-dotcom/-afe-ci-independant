import test from "node:test";
import assert from "node:assert/strict";
import { calculateStrategicFinancialModel } from "../src/strategic-financial.js";

test("calcule les indicateurs unitaires uniquement à partir des entrées explicites",()=>{
 const r=calculateStrategicFinancialModel({currency:"XOF",targetActiveUsers:100000,fundingCap:500000000,activeUsersM12:100,activeUsersM24:300,activeUsersM36:600,pessimisticActiveUsersM36:250,optimisticActiveUsersM36:1200,monthlyRevenuePerActive:1000,monthlyVariableCostPerActive:400,monthlyFixedCosts:300000,customerAcquisitionCost:1800,monthlyChurnRatePct:5});
 assert.equal(r.contributionPerActive,600);
 assert.equal(r.breakEvenActiveUsers,500);
 assert.equal(r.cacPaybackMonths,3);
 assert.equal(r.estimatedLtv,12000);
 assert.equal(r.ltvToCac,6.67);
 assert.equal(r.scenarios[1].operatingResult,60000);
 assert.equal(r.monthlyProjection[0].operatingResult,-240000);
 assert.equal(r.cumulativeOperatingResult36,-5760000);
 assert.equal(r.inputs.every(x=>x.basis==="provided"),true);
});
test("ne transforme jamais une donnée absente en zéro",()=>{
 const r=calculateStrategicFinancialModel({});
 assert.equal(r.status,"insufficient");
 assert.equal(r.breakEvenActiveUsers,null);
 assert.equal(r.scenarios[1].operatingResult,null);
 assert.equal(r.cumulativeOperatingResult36,null);
 assert.equal(r.inputs.every(x=>x.value===null&&x.basis==="unknown"),true);
});
test("refuse une LTV si l'attrition est absente ou nulle",()=>{
 const r=calculateStrategicFinancialModel({monthlyRevenuePerActive:1000,monthlyVariableCostPerActive:400,monthlyFixedCosts:10000,activeUsersM36:100,customerAcquisitionCost:2000,monthlyChurnRatePct:0});
 assert.equal(r.estimatedLtv,null);
 assert.equal(r.ltvToCac,null);
});
