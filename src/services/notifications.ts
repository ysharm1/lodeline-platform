/** EmailSender port (kept from LoadEnergy src/services/notifications.ts). */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}
export interface EmailSendResult {
  providerMessageId: string | null;
}
export interface EmailSender {
  readonly name: string;
  send(message: EmailMessage): Promise<EmailSendResult>;
}
