import 'dotenv/config';
import { createProductionMPCWallet, loadMPCConfigFromEnv } from './dist/01-core/wallet/mpc-integration.js';
import { PeerPayClient } from '@bsv/message-box-client';

setTimeout(() => { console.log('TIMEOUT after 30s'); process.exit(1); }, 30000);

(async () => {
  try {
    const mpcConfig = loadMPCConfigFromEnv();
    console.log('Creating MPC wallet...');
    const result = await createProductionMPCWallet(mpcConfig);
    console.log('Wallet ready. PubKey:', result.collectivePublicKey);
    
    console.log('Initializing PeerPay...');
    const ppClient = new PeerPayClient({
      walletClient: result.wallet,
      enableLogging: true,
    });
    
    console.log('Listing incoming payments...');
    const payments = await ppClient.listIncomingPayments();
    console.log('Incoming payments:', payments.length);
    for (const p of payments) {
      console.log(`  From: ${p.sender}, Amount: ${p.token?.amount} sats, MsgID: ${p.messageId}`);
    }
    
    if (payments.length > 0) {
      console.log('\nTo accept these, run with --accept flag');
    } else {
      console.log('No pending payments found.');
    }
    
    // Don't call destroy - it hangs
    process.exit(0);
  } catch(e) {
    console.error('Error:', e.message);
    console.error(e.stack);
    process.exit(1);
  }
})();
