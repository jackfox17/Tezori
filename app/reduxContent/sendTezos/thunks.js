import { TezosOperations } from 'conseiljs';
import { updateIdentity } from '../../reduxContent/wallet/actions';
import { addMessage } from '../../reduxContent/message/thunks';
import { TEZOS } from '../../constants/NodesTypes';
import { tezToUtez } from '../../utils/currancy';
import { displayError } from '../../utils/formValidation';
import { persistWalletState } from '../../utils/wallet';
import { createTransaction } from '../../utils/transaction';
import { TRANSACTION } from '../../constants/TransactionTypes';

import {
  getSelectedKeyStore,
  fetchAverageFees,
  clearOperationId
} from '../../utils/general';

import { findAccountIndex } from '../../utils/account';
import { findIdentity } from '../../utils/identity';

import { getSelectedNode } from '../../utils/nodes';

const { sendTransactionOperation } = TezosOperations;

export function fetchTransactionAverageFees() {
  return async (dispatch, state) => {
    const nodes = state().nodes.toJS();
    const averageFees = await fetchAverageFees(nodes, 'transaction');
    return averageFees;
  };
}

export function validateAmount(amount, toAddress) {
  return async dispatch => {
    const parsedAmount = Number(amount.replace(/,/g, '.'));
    const amountInUtez = tezToUtez(parseFloat(parsedAmount));

    const validations = [
      { value: amount, type: 'notEmpty', name: 'Amount' },
      { value: parsedAmount, type: 'validAmount' },
      { value: amountInUtez, type: 'posNum', name: 'Amount' },
      { value: toAddress, type: 'validAddress' }
    ];

    const error = displayError(validations);
    if (error) {
      dispatch(addMessage(error, true));
      return false;
    }

    return true;
  };
}

export function sendTez(
  password,
  toAddress,
  amount,
  fee,
  selectedAccountHash,
  selectedParentHash
) {
  return async (dispatch, state) => {
    const nodes = state().nodes.toJS();
    const identities = state()
      .wallet.get('identities')
      .toJS();
    const walletPassword = state().wallet.get('password');
    const keyStore = getSelectedKeyStore(
      identities,
      selectedAccountHash,
      selectedParentHash
    );

    if (password !== walletPassword) {
      const error = 'Incorrect password';
      dispatch(addMessage(error, true));
      return false;
    }

    if (toAddress === selectedAccountHash) {
      const error = 'You cant sent money to yourself.';
      dispatch(addMessage(error, true));
      return false;
    }

    const { url, apiKey } = getSelectedNode(nodes, TEZOS);
    console.log('-debug: - kkkkk - url, apiKey ', url, apiKey);
    const parsedAmount = tezToUtez(Number(amount.replace(/,/g, '.')));
    const res = await sendTransactionOperation(
      url,
      keyStore,
      toAddress,
      parsedAmount,
      fee
    ).catch(err => {
      const errorObj = { name: err.message, ...err };
      console.error(errorObj);
      dispatch(addMessage(errorObj.name, true));
      return false;
    });

    if (res) {
      console.log('-debug: res', res);
      const operationResult = res
        && res.results
        && res.results.contents
        && res.results.contents[0]
        && res.results.contents[0].metadata
        && res.results.contents[0].metadata.operation_result;

      if ( operationResult && operationResult.errors && operationResult.errors.length ) {
        const error = 'Send operation failed';
        console.error(error);
        dispatch(addMessage(error, true));
        return false;
      }

      const identity = findIdentity(identities, selectedParentHash);
      const clearedOperationId = clearOperationId(res.operationGroupID);
      const transaction = createTransaction({
        amount: parsedAmount,
        destination: toAddress,
        kind: TRANSACTION,
        source: keyStore.publicKeyHash,
        operationGroupHash: clearedOperationId,
        fee
      });
      
      if ( selectedParentHash === selectedAccountHash ) {
        identity.transactions.push(transaction);
      } else {
        const accountIndex = findAccountIndex(identity, selectedAccountHash);
        if ( accountIndex > -1 ) {
          identity.accounts[accountIndex].transactions.push(transaction);
        }
      }

      dispatch(updateIdentity(identity));

      let i = 0;
      const l = identities.length;
      for ( i; i < l; i += 1 ) {
        const receivingIdentity = identities[i];
        if ( receivingIdentity.publicKeyHash === toAddress ) {
          receivingIdentity.transactions.push(transaction);
          dispatch(updateIdentity(receivingIdentity));
          break;
        }

        const accountIndex = findAccountIndex(receivingIdentity, toAddress);
        if ( accountIndex > -1 ) {
          receivingIdentity.accounts[accountIndex].transactions.push(transaction);
          dispatch(updateIdentity(receivingIdentity));
          break;
        }
      }

      await persistWalletState(state().wallet.toJS());
      
      dispatch(
        addMessage(
          `Success! You sent ${amount} tz.`,
          false,
          clearedOperationId
        )
      );
      return true;
    }
    return false;
  };
}
