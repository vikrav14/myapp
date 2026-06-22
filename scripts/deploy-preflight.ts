import { getDeployPreflightReport } from "../lib/deploy-preflight.js";

const report = getDeployPreflightReport();

console.log(`Mauri deploy preflight (${report.environment})`);
console.log(`Ready for production traffic: ${report.ready ? "yes" : "no"}`);
console.log("");

if (report.publicBaseUrl) {
  console.log("Public base URL:", report.publicBaseUrl);
} else {
  console.log("Public base URL: not configured");
}

console.log("");
console.log("Webhook URLs to register with providers:");
console.log("  WhatsApp:", report.webhookUrls.whatsapp ?? "(set PAYMENT_CALLBACK_BASE_URL)");
console.log("  MCB Juice:", report.webhookUrls.juiceCallback ?? "(set PAYMENT_CALLBACK_BASE_URL)");
console.log("  Blink:", report.webhookUrls.blinkCallback ?? "(set PAYMENT_CALLBACK_BASE_URL)");
console.log("");

console.log("Payment providers:");
console.log("  Peach Juice automation:", report.paymentProviders.peachJuiceAutomation ? "enabled" : "disabled");
console.log("  Blink automation:", report.paymentProviders.blinkAutomation ? "enabled" : "disabled");
console.log("  Manual Juice link:", report.paymentProviders.manualJuiceLink ? "yes" : "no");
console.log("  Manual Blink link:", report.paymentProviders.manualBlinkLink ? "yes" : "no");
console.log("");

for (const check of report.checks) {
  const marker = check.status === "ok" ? "[ok]" : check.status === "warning" ? "[warn]" : "[error]";
  console.log(`${marker} ${check.label}: ${check.message}`);
}

process.exit(report.ready ? 0 : 1);
