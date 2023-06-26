import React from 'react'

function About() {
  return (
    <div>
      <div className="about-title">About SwapChan Dex</div>
      <div>SwapChan Dex is a decentralized exchange for swapping ERC20 tokens on the Ethereum blockchain.</div>
      <div>SwapChan Dex is powered by <a href="https://moralis.io">Moralis</a> and <a href="https://uniswap.io">Uniswap</a>.</div>
      <div>Simply connect your wallet and enter the amount of tokens you want to swap.</div>
      <div>SwapChan Dex will automatically calculate the amount of tokens you will receive.</div>
      <div>Click the "Swap" button to complete the transaction.</div>
      <div>SwapChan Dex will automatically route your transaction through the best available liquidity pool.</div>
      <div>SwapChan Dex is a work in progress. Please report any bugs to <a href="mailto:swapchan@nefariousplan.com">swapchan@nefariousplan.com</a></div>
    </div>
  )
}

export default About