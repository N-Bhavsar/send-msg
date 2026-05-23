export function buildReminderMessage(record) {
  const expiryText = new Date(record.expiryDate).toISOString().slice(0, 10);
  const vehicleNumber = record.vehicleNumber || record.vehicleNo || "UNKNOWN";
  return (
    `Hello ${record.name},\n` +
    `This is a reminder that the insurance for your VEHICAL NO (${vehicleNumber}) is about to expire on ${expiryText}.\n` +
    "Please renew your insurance on time."
  );
}

