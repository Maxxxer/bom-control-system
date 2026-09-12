const { spawnSync } = require("child_process");
const tests = [
  "_local_tests/v12_delivery_test.js",
  "_local_tests/v12_picking_schema_test.js",
  "_local_tests/v12_audit_fixes_test.js",
  "_local_tests/v12_audit_fixes2_test.js",
  "_local_tests/v12_deficit_status_test.js",
  "_local_tests/v12_supply_schema_test.js",
  "_local_tests/v12_deficit_filter_test.js",
  "_local_tests/v12_queue_test.js",
  "_local_tests/v12_ui_test.js"
];
const files = [
  "v12_config.js", "utils.js", "sheet_service.js", "v12_utils.js", "v12_calculate.js",
  "v12_position_state.js", "v12_material_state.js", "v12_audit.js", "v12_roles.js",
  "v12_source.js", "v12_sheet_service.js", "v12_projections.js", "v12_operations.js",
  "v12_handoff.js", "v12_change_engine.js", "v12_events.js", "lock.js", "v12_trigger.js",
  "v12_queue.js", "v12_ui.js", "v12_controller.js", "logger.js"
];
let report = "";
let syntaxBad = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ["--check", f], { encoding: "utf8" });
  if (r.status !== 0) { syntaxBad++; report += "SYNTAX FAIL: " + f + "\n" + (r.stderr || "").slice(0, 200) + "\n"; }
}
report += "node --check: файлов=" + files.length + " ошибок=" + syntaxBad + "\n";
for (const t of tests) {
  const r = spawnSync(process.execPath, [t], { encoding: "utf8" });
  const stdout = r.stdout || "";
  const lines = stdout.split("\n");
  const fails = lines.filter(function (l) { return l.indexOf("FAIL") === 0; });
  const last = lines.filter(Boolean).pop() || "";
  report += t + " exit=" + r.status + " fails=" + fails.length + " last=" + last + "\n";
  fails.forEach(function (f) { report += "  " + f + "\n"; });
  if (r.stderr && r.stderr.trim()) { report += "  STDERR: " + r.stderr.trim().split("\n").slice(0, 3).join(" | ") + "\n"; }
}
require("fs").writeFileSync("_tmp_res.txt", report);
console.log(report);
