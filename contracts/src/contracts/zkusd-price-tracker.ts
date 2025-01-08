import {
  method,
  Provable,
  SmartContract,
  state,
  State,
  UInt32,
  UInt64,
} from 'o1js';
import {
  OracleWhitelist,
  PriceSubmission,
  PriceSubmissionPacked,
} from '../types.js';

/**
 * @title   zkUSD Price Tracker contract
 * @notice  This contract is used to track the prices of the zkUSD system.
 *          Two versions of this are installed on the token account of the engine.
 *          One is used for the even blocks and one is used for the odd blocks.
 *          This allows us to avoid the concurrency issues that arise from L1 development.
 */

export class ZkUsdPriceTracker extends SmartContract {
  @state(PriceSubmissionPacked) oracleOne = State<PriceSubmissionPacked>();
  @state(PriceSubmissionPacked) oracleTwo = State<PriceSubmissionPacked>();
  @state(PriceSubmissionPacked) oracleThree = State<PriceSubmissionPacked>();
  @state(PriceSubmissionPacked) oracleFour = State<PriceSubmissionPacked>();
  @state(PriceSubmissionPacked) oracleFive = State<PriceSubmissionPacked>();
  @state(PriceSubmissionPacked) oracleSix = State<PriceSubmissionPacked>();
  @state(PriceSubmissionPacked) oracleSeven = State<PriceSubmissionPacked>();
  @state(PriceSubmissionPacked) oracleEight = State<PriceSubmissionPacked>();

  /**
   * @notice  Calculates the median price from submitted oracle prices
   * @dev     The function follows these steps:
   *          1. Pads the price array with fallback prices
   *          2. Sorts all prices using bubble sort
   *          3. Calculates the median price
   * @param   fallbackPrice Used to pad the array if we have fewer incase oracles
   *                        fail to submit a price
   * @returns The calculated median price
   */
  @method.returns(UInt64)
  async calculateMedianPrice(fallbackPrice: UInt64) {
    //Get the block number
    const blockchainLength =
      this.network.blockchainLength.getAndRequireEquals();

    const currentState = [
      this.oracleOne.getAndRequireEquals(),
      this.oracleTwo.getAndRequireEquals(),
      this.oracleThree.getAndRequireEquals(),
      this.oracleFour.getAndRequireEquals(),
      this.oracleFive.getAndRequireEquals(),
      this.oracleSix.getAndRequireEquals(),
      this.oracleSeven.getAndRequireEquals(),
      this.oracleEight.getAndRequireEquals(),
    ];

    //Create an array to store the valid prices
    let prices = Array(OracleWhitelist.MAX_PARTICIPANTS).fill(fallbackPrice);

    //Unpack the submissions and check if they are from the previous block
    for (let i = 0; i < currentState.length; i++) {
      const submission = PriceSubmission.unpack(currentState[i]);

      const isFromPreviousBlock = submission.blockNumber.equals(
        blockchainLength.sub(UInt32.from(1))
      );

      prices[i] = Provable.if(
        isFromPreviousBlock.and(submission.price.greaterThan(UInt64.from(0))),
        submission.price,
        fallbackPrice
      );
    }

    // Sort prices using bubble sort
    for (let i = 0; i < prices.length - 1; i++) {
      for (let j = 0; j < prices.length - i - 1; j++) {
        let shouldSwap = prices[j].greaterThan(prices[j + 1]);
        let temp = Provable.if(shouldSwap, prices[j], prices[j + 1]);
        prices[j] = Provable.if(shouldSwap, prices[j + 1], prices[j]);
        prices[j + 1] = temp;
      }
    }

    //Middle index for median
    const middleIndex = Math.floor(prices.length / 2);

    const medianPrice = prices[middleIndex - 1]
      .add(prices[middleIndex])
      .div(UInt64.from(2));

    //Return the median price
    return medianPrice;
  }
}
