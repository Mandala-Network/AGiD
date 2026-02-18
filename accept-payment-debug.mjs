import 'dotenv/config';
import { createProductionMPCWallet, loadMPCConfigFromEnv } from './dist/01-core/wallet/mpc-integration.js';
import { PeerPayClient } from '@bsv/message-box-client';

setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 60000);

(async () => {
  try {
    const mpcConfig = loadMPCConfigFromEnv();
    const result = await createProductionMPCWallet(mpcConfig);
    const wallet = result.wallet;
    
    const ppClient = new PeerPayClient({
      walletClient: wallet,
      enableLogging: false,
    });
    
    const payments = await ppClient.listIncomingPayments();
    console.log(`Found ${payments.length} payment(s)`);
    
    if (payments.length === 0) {
      console.log('No payments to accept');
      process.exit(0);
    }
    
    const p = payments[0];
    console.log('Payment token keys:', Object.keys(p.token));
    console.log('Amount:', p.token.amount);
    console.log('OutputIndex:', p.token.outputIndex);
    console.log('TX type:', typeof p.token.transaction);
    console.log('TX length:', Array.isArray(p.token.transaction) ? p.token.transaction.length : 
                 typeof p.token.transaction === 'string' ? p.token.transaction.length : 'unknown');
    console.log('derivationPrefix:', p.token.customInstructions?.derivationPrefix);
    console.log('derivationSuffix:', p.token.customInstructions?.derivationSuffix);
    
    // Try internalizeAction directly
    try {
      console.log('\nCalling internalizeAction directly...');
      const ir = await wallet.internalizeAction({
        tx: p.token.transaction,
        outputs: [{
          paymentRemittance: {
            derivationPrefix: p.token.customInstructions.derivationPrefix,
            derivationSuffix: p.token.customInstructions.derivationSuffix,
            senderIdentityKey: p.sender
          },
          outputIndex: p.token.outputIndex ?? 0,
          protocol: 'wallet payment'
        }],
        labels: ['peerpay'],
        description: 'PeerPay Payment'
      });
      console.log('internalizeAction result:', JSON.stringify(ir));
    } catch(e) {
      console.error('internalizeAction ERROR:', e.message);
      console.error('Stack:', e.stack?.split('\n').slice(0,5).join('\n'));
    }
    
    process.exit(0);
  } catch(e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
