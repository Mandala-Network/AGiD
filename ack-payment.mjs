import 'dotenv/config';
import { createProductionMPCWallet, loadMPCConfigFromEnv } from './dist/01-core/wallet/mpc-integration.js';
import { PeerPayClient } from '@bsv/message-box-client';

setTimeout(() => process.exit(0), 30000);

(async () => {
  const result = await createProductionMPCWallet(loadMPCConfigFromEnv());
  const ppClient = new PeerPayClient({ walletClient: result.wallet, enableLogging: false });
  
  const payments = await ppClient.listIncomingPayments();
  console.log(`Found ${payments.length} pending payment(s)`);
  
  for (const p of payments) {
    console.log(`Acknowledging messageId: ${p.messageId}`);
    await ppClient.acknowledgeMessage({ messageIds: [p.messageId] });
    console.log('Acknowledged');
  }
  
  process.exit(0);
})();
