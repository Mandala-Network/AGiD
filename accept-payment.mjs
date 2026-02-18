import 'dotenv/config';
import { createProductionMPCWallet, loadMPCConfigFromEnv } from './dist/01-core/wallet/mpc-integration.js';
import { PeerPayClient } from '@bsv/message-box-client';

setTimeout(() => { console.log('TIMEOUT after 60s'); process.exit(1); }, 60000);

(async () => {
  try {
    const mpcConfig = loadMPCConfigFromEnv();
    console.log('Creating MPC wallet...');
    const result = await createProductionMPCWallet(mpcConfig);
    console.log('Wallet ready.');
    
    const ppClient = new PeerPayClient({
      walletClient: result.wallet,
      enableLogging: false,
    });
    
    console.log('Listing incoming payments...');
    const payments = await ppClient.listIncomingPayments();
    console.log(`Found ${payments.length} payment(s)`);
    
    for (const p of payments) {
      console.log(`\nAccepting payment: ${p.token?.amount} sats from ${p.sender.slice(0,16)}...`);
      try {
        const result = await ppClient.acceptPayment(p);
        console.log('Accepted!', JSON.stringify(result));
      } catch (e) {
        console.error('Failed to accept:', e.message);
      }
    }
    
    process.exit(0);
  } catch(e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
