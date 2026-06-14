import { parseItrJson } from "../src/tax/itrParser";

let pass = 0, fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; return; }
  fail++;
  console.error(`FAIL: ${label}\n   got: ${a}\n  want: ${e}`);
}

// Synthetic ITR-1 with the bare minimum
const itr1Json = {
  ITR: {
    ITR1: {
      CreationInfo: { SWVersionNo: "1.0" },
      Form_ITR1: { FormName: "ITR-1" },
      PersonalInfo: { PAN: "ABCDE1234F", Name: { FirstName: "Test" } },
      FilingStatus: { AY: "2026-27" },
      ITR1_IncomeDeductions: {
        GrossSalary: 1200000,
        TotalIncomeChargeableUnHP: 0,
        IncomeOthSrc: 25000,
        GrossTotIncome: 1225000,
        TotalIncome: 1075000,
        ExemptIncAgriOthUs10: 0,
        UsrDeductUndChapVIA: {
          Section80C: 150000,
          Section80D: 25000,
        },
      },
      ITR1_TaxComputation: {
        TotalTaxPayable: 130000,
        Rebate87A: 0,
        EducationCess: 5200,
        NetTaxLiability: 135200,
      },
      TaxPaid: {
        TaxesPaid: { TotalTaxesPaid: 135200 },
        BalTaxPayable: 0,
      },
      TDSonSalaries: {
        TDSonSalary: [
          {
            EmployerOrDeductorOrCollectDetl: {
              EmployerOrDeductorOrCollecterName: "Acme Corp",
              TAN: "DELA12345A",
            },
            TotalTDSSal: 135200,
          },
        ],
      },
    },
  },
};

const r1 = parseItrJson(itr1Json, "test.json");
check("ITR-1 form detected", r1.itrForm, "1");
check("ITR-1 AY", r1.ay, "2026-27");
check("ITR-1 PAN", r1.pan, "ABCDE1234F");
check("ITR-1 income heads", r1.income.map((i) => i.head), ["salary", "other_sources"]);
check("ITR-1 salary amount", r1.income[0].amount, 1200000);
check("ITR-1 80C found", r1.deductions.find((d) => d.section === "80C")?.amount, 150000);
check("ITR-1 80D found", r1.deductions.find((d) => d.section === "80D")?.amount, 25000);
check("ITR-1 tds payer", r1.payments[0].payer_name, "Acme Corp");
check("ITR-1 tds amount", r1.payments[0].amount, 135200);
check("ITR-1 GTI", r1.assessment.gross_total_income, 1225000);
check("ITR-1 net tax", r1.assessment.net_tax_liability, 135200);

// Synthetic ITR-2 with capital gains
const itr2Json = {
  ITR: {
    ITR2: {
      PersonalInfo: { PAN: "PQRSU5678G" },
      FilingStatus: { AY: "2026-27" },
      ITR2_IncomeDeductions: { GrossSalary: 2500000, GrossTotIncome: 2800000, TotalIncome: 2650000 },
      ScheduleCG: { TotalSTCG: 50000, TotalLTCG: 120000 },
      ITR2_TaxComputation: { TotalTaxPayable: 500000 },
    },
  },
};
const r2 = parseItrJson(itr2Json, "test2.json");
check("ITR-2 form", r2.itrForm, "2");
check("ITR-2 CG short found", r2.income.find((i) => i.head === "cg_short")?.amount, 50000);
check("ITR-2 CG long found", r2.income.find((i) => i.head === "cg_long")?.amount, 120000);

// Garbage / empty input
const empty = parseItrJson({}, "empty.json");
check("empty input → null form", empty.itrForm, null);
check("empty input → 0 income", empty.income.length, 0);

console.log(`${pass}/${pass + fail} passed.`);
if (fail > 0) process.exit(1);
