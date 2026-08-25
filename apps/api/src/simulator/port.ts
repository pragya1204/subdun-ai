export interface PaymentResult {
  success: boolean;
  paymentId: string;
}

export interface DeliveryResult {
  delivered: boolean;
}

/**
 * Abstract provider boundary. The Simulator Adapter is the only implementation
 * for the MVP; swapping in a real Razorpay adapter later touches only this module.
 */
export interface ProviderPort {
  retryPayment(params: {
    subscriptionId: string;
    amount: number;
    paymentMethodId: string;
  }): Promise<PaymentResult>;
  sendMessage(params: {
    recoveryCaseId: string;
    subscriptionId: string;
    kind: "OUTREACH" | "REQUEST_PAYMENT_METHOD_UPDATE" | "REQUEST_CUSTOMER_ACTION";
    channel: string;
    template: string;
  }): Promise<DeliveryResult>;
}
