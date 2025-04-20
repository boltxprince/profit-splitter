// server.js - Main backend file for the SplitWise profit-splitting platform

const express = require('express');
const path = require('path');
const Web3 = require('web3');
const bodyParser = require('body-parser');
const cors = require('cors');
const dotenv = require('dotenv');
const { validationResult, check } = require('express-validator');

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Web3 setup - connect to Ethereum node
let web3;
if (process.env.ETHEREUM_NODE_URL) {
  web3 = new Web3(new Web3.providers.HttpProvider(process.env.ETHEREUM_NODE_URL));
} else {
  console.warn('No Ethereum node URL specified, using Infura mainnet');
  web3 = new Web3(new Web3.providers.HttpProvider('https://mainnet.infura.io/v3/' + process.env.INFURA_API_KEY));
}

// ABI for the SplitWise contract
const splitwiseABI = [
  {
    "inputs": [
      {
        "internalType": "address[]",
        "name": "_recipients",
        "type": "address[]"
      },
      {
        "internalType": "uint256[]",
        "name": "_shares",
        "type": "uint256[]"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "PaymentReleased",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "address",
        "name": "from",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "PaymentReceived",
    "type": "event"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "index",
        "type": "uint256"
      }
    ],
    "name": "payee",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "released",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "releasable",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address payable",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "release",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "shares",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "totalReleased",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "totalShares",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "stateMutability": "payable",
    "type": "receive"
  }
];

// ERC4626 Vault ABI (simplified)
const erc4626ABI = [
  {
    "inputs": [],
    "name": "totalAssets",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "address", "name": "owner", "type": "address"}],
    "name": "balanceOf",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "uint256", "name": "shares", "type": "uint256"}],
    "name": "convertToAssets",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  }
];

// NFT Marketplace ABI (simplified for royalty distribution)
const nftMarketplaceABI = [
  {
    "inputs": [{"internalType": "uint256", "name": "tokenId", "type": "uint256"}],
    "name": "getRoyaltyInfo",
    "outputs": [
      {"internalType": "address", "name": "receiver", "type": "address"},
      {"internalType": "uint256", "name": "royaltyAmount", "type": "uint256"}
    ],
    "stateMutability": "view",
    "type": "function"
  }
];

// Database simulation (In a production app, use a real database like MongoDB or PostgreSQL)
const contracts = [];
const distributions = [];

// Routes

// Get contract details
app.get('/api/contract/:address', async (req, res) => {
  try {
    const contractAddress = req.params.address;
    
    // Validate contract address
    if (!web3.utils.isAddress(contractAddress)) {
      return res.status(400).json({ error: 'Invalid contract address' });
    }
    
    const splitwiseContract = new web3.eth.Contract(splitwiseABI, contractAddress);
    
    // Get contract details
    const totalShares = await splitwiseContract.methods.totalShares().call();
    const totalReleased = await splitwiseContract.methods.totalReleased().call();
    
    // Get all payees and their shares (we'll loop until we get an error)
    const payees = [];
    let index = 0;
    let continueLoop = true;
    
    while (continueLoop) {
      try {
        const payeeAddress = await splitwiseContract.methods.payee(index).call();
        const shares = await splitwiseContract.methods.shares(payeeAddress).call();
        const released = await splitwiseContract.methods.released(payeeAddress).call();
        const releasable = await splitwiseContract.methods.releasable(payeeAddress).call();
        
        payees.push({
          address: payeeAddress,
          shares: shares,
          percentage: (shares * 100 / totalShares).toFixed(2),
          released: web3.utils.fromWei(released, 'ether'),
          releasable: web3.utils.fromWei(releasable, 'ether')
        });
        
        index++;
      } catch (err) {
        continueLoop = false;
      }
    }
    
    // Get contract balance
    const balance = await web3.eth.getBalance(contractAddress);
    
    return res.json({
      address: contractAddress,
      totalShares: totalShares,
      totalReleased: web3.utils.fromWei(totalReleased, 'ether'),
      balance: web3.utils.fromWei(balance, 'ether'),
      payees: payees
    });
  } catch (error) {
    console.error('Error fetching contract details:', error);
    return res.status(500).json({ error: 'Failed to fetch contract details' });
  }
});

// Deploy new contract
app.post(
  '/api/deploy', 
  [
    check('recipients').isArray({ min: 1 }).withMessage('At least one recipient is required'),
    check('shares').isArray({ min: 1 }).withMessage('At least one share value is required'),
    check('recipients.*.address').isEthereumAddress().withMessage('Valid Ethereum addresses required'),
    check('shares.*').isInt({ min: 1 }).withMessage('Share values must be positive integers'),
    check('privateKey').isString().withMessage('Private key is required')
  ],
  async (req, res) => {
    // Validate request
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    try {
      const { recipients, shares, privateKey } = req.body;
      
      // Validate array lengths match
      if (recipients.length !== shares.length) {
        return res.status(400).json({ error: 'Recipients and shares arrays must have the same length' });
      }
      
      // Set up account from private key
      const account = web3.eth.accounts.privateKeyToAccount(privateKey);
      web3.eth.accounts.wallet.add(account);
      
      // Prepare contract deployment
      const splitwiseContract = new web3.eth.Contract(splitwiseABI);
      const recipientAddresses = recipients.map(r => r.address);
      
      // Deploy contract
      const deployTransaction = splitwiseContract.deploy({
        data: process.env.CONTRACT_BYTECODE,
        arguments: [recipientAddresses, shares]
      });
      
      const gas = await deployTransaction.estimateGas({ from: account.address });
      const gasPrice = await web3.eth.getGasPrice();
      
      const deployedContract = await deployTransaction.send({
        from: account.address,
        gas,
        gasPrice
      });
      
      // Save to our database
      contracts.push({
        address: deployedContract.options.address,
        creator: account.address,
        recipients: recipientAddresses,
        shares: shares,
        createdAt: new Date()
      });
      
      return res.status(201).json({
        success: true,
        contractAddress: deployedContract.options.address,
        recipients: recipientAddresses,
        shares: shares
      });
    } catch (error) {
      console.error('Error deploying contract:', error);
      return res.status(500).json({ error: 'Failed to deploy contract' });
    }
  }
);

// Connect ERC-4626 vault to contract
app.post(
  '/api/connect/vault',
  [
    check('contractAddress').isEthereumAddress().withMessage('Valid contract address required'),
    check('vaultAddress').isEthereumAddress().withMessage('Valid vault address required'),
    check('privateKey').isString().withMessage('Private key is required')
  ],
  async (req, res) => {
    // Validate request
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    try {
      const { contractAddress, vaultAddress, privateKey } = req.body;
      
      // Set up account from private key
      const account = web3.eth.accounts.privateKeyToAccount(privateKey);
      web3.eth.accounts.wallet.add(account);
      
      // Initialize contracts
      const splitwiseContract = new web3.eth.Contract(splitwiseABI, contractAddress);
      const vaultContract = new web3.eth.Contract(erc4626ABI, vaultAddress);
      
      // Check if the vault has approved the contract
      // In a real implementation, you would need to set up appropriate permissions
      
      // Record the connection
      distributions.push({
        contractAddress,
        sourceType: 'vault',
        sourceAddress: vaultAddress,
        connectedAt: new Date()
      });
      
      return res.json({
        success: true,
        message: 'Vault connected successfully'
      });
    } catch (error) {
      console.error('Error connecting vault:', error);
      return res.status(500).json({ error: 'Failed to connect vault' });
    }
  }
);

// Connect NFT collection to contract for royalty distribution
app.post(
  '/api/connect/nft',
  [
    check('contractAddress').isEthereumAddress().withMessage('Valid contract address required'),
    check('nftAddress').isEthereumAddress().withMessage('Valid NFT address required'),
    check('privateKey').isString().withMessage('Private key is required')
  ],
  async (req, res) => {
    // Validate request
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    try {
      const { contractAddress, nftAddress, privateKey } = req.body;
      
      // Set up account from private key
      const account = web3.eth.accounts.privateKeyToAccount(privateKey);
      web3.eth.accounts.wallet.add(account);
      
      // In a real implementation, you would create a connection between the NFT contract
      // and the SplitWise contract to handle royalty distributions
      
      // Record the connection
      distributions.push({
        contractAddress,
        sourceType: 'nft',
        sourceAddress: nftAddress,
        connectedAt: new Date()
      });
      
      return res.json({
        success: true,
        message: 'NFT collection connected successfully'
      });
    } catch (error) {
      console.error('Error connecting NFT collection:', error);
      return res.status(500).json({ error: 'Failed to connect NFT collection' });
    }
  }
);

// Get distribution history
app.get('/api/distributions/:contractAddress', async (req, res) => {
  try {
    const contractAddress = req.params.contractAddress;
    
    // Validate contract address
    if (!web3.utils.isAddress(contractAddress)) {
      return res.status(400).json({ error: 'Invalid contract address' });
    }
    
    const splitwiseContract = new web3.eth.Contract(splitwiseABI, contractAddress);
    
    // Get events to show distribution history
    const events = await splitwiseContract.getPastEvents('PaymentReleased', {
      fromBlock: 0,
      toBlock: 'latest'
    });
    
    const distributionHistory = events.map(event => {
      return {
        recipient: event.returnValues.recipient,
        amount: web3.utils.fromWei(event.returnValues.amount, 'ether'),
        blockNumber: event.blockNumber,
        transactionHash: event.transactionHash,
        timestamp: null // In a real app, you would fetch the block timestamp
      };
    });
    
    return res.json({
      contractAddress,
      distributions: distributionHistory
    });
  } catch (error) {
    console.error('Error fetching distribution history:', error);
    return res.status(500).json({ error: 'Failed to fetch distribution history' });
  }
});

// Release funds to a payee
app.post(
  '/api/release',
  [
    check('contractAddress').isEthereumAddress().withMessage('Valid contract address required'),
    check('payee').isEthereumAddress().withMessage('Valid payee address required'),
    check('privateKey').isString().withMessage('Private key is required')
  ],
  async (req, res) => {
    // Validate request
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    try {
      const { contractAddress, payee, privateKey } = req.body;
      
      // Set up account from private key
      const account = web3.eth.accounts.privateKeyToAccount(privateKey);
      web3.eth.accounts.wallet.add(account);
      
      // Initialize contract
      const splitwiseContract = new web3.eth.Contract(splitwiseABI, contractAddress);
      
      // Check releasable amount
      const releasable = await splitwiseContract.methods.releasable(payee).call();
      
      if (releasable <= 0) {
        return res.status(400).json({ error: 'No funds available to release for this payee' });
      }
      
      // Release funds
      const gas = await splitwiseContract.methods.release(payee).estimateGas({ from: account.address });
      const gasPrice = await web3.eth.getGasPrice();
      
      const receipt = await splitwiseContract.methods.release(payee).send({
        from: account.address,
        gas,
        gasPrice
      });
      
      return res.json({
        success: true,
        transactionHash: receipt.transactionHash,
        released: web3.utils.fromWei(releasable, 'ether')
      });
    } catch (error) {
      console.error('Error releasing funds:', error);
      return res.status(500).json({ error: 'Failed to release funds' });
    }
  }
);

// Route for simulating profit distribution (calculator demo on the frontend)
app.post('/api/calculator', [
  check('totalProfit').isNumeric().withMessage('Total profit must be a number'),
  check('currency').isString().withMessage('Currency is required'),
  check('contributors').isArray({ min: 1 }).withMessage('At least one contributor is required'),
  check('contributors.*.percentage').isNumeric().withMessage('Percentage must be a number')
], (req, res) => {
  // Validate request
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  
  const { totalProfit, currency, contributors } = req.body;
  
  // Calculate distribution
  const totalPercentage = contributors.reduce((sum, contributor) => sum + parseFloat(contributor.percentage), 0);
  
  if (Math.abs(totalPercentage - 100) > 0.01) {
    return res.status(400).json({ error: 'Total percentage must equal 100%' });
  }
  
  const distribution = contributors.map(contributor => {
    const amount = (totalProfit * contributor.percentage / 100).toFixed(2);
    return {
      name: contributor.name,
      address: contributor.address,
      percentage: contributor.percentage,
      amount: amount,
      currency: currency
    };
  });
  
  return res.json({
    totalProfit,
    currency,
    distribution
  });
});

// Route for getting user contracts
app.get('/api/user/contracts/:address', (req, res) => {
  const userAddress = req.params.address;
  
  // Validate address
  if (!web3.utils.isAddress(userAddress)) {
    return res.status(400).json({ error: 'Invalid Ethereum address' });
  }
  
  // Filter contracts by user address (creator or recipient)
  const userContracts = contracts.filter(contract => {
    return contract.creator === userAddress || contract.recipients.includes(userAddress);
  });
  
  return res.json({
    address: userAddress,
    contracts: userContracts
  });
});

// Vesting simulator route
app.post('/api/vesting/simulate', [
  check('totalAmount').isNumeric().withMessage('Total amount must be a number'),
  check('vestingDuration').isNumeric().withMessage('Vesting duration must be a number'),
  check('cliff').isNumeric().withMessage('Cliff must be a number'),
  check('startDate').isISO8601().withMessage('Valid start date required'),
  check('contributors').isArray({ min: 1 }).withMessage('At least one contributor is required')
], (req, res) => {
  // Validate request
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  
  const { totalAmount, vestingDuration, cliff, startDate, contributors } = req.body;
  
  // Convert durations to milliseconds
  const vestingDurationMs = vestingDuration * 24 * 60 * 60 * 1000; // days to ms
  const cliffMs = cliff * 24 * 60 * 60 * 1000; // days to ms
  const startTimestamp = new Date(startDate).getTime();
  const endTimestamp = startTimestamp + vestingDurationMs;
  const cliffTimestamp = startTimestamp + cliffMs;
  
  // Calculate vesting schedule
  const currentTimestamp = Date.now();
  const schedules = contributors.map(contributor => {
    const allocation = totalAmount * (contributor.percentage / 100);
    let vestedAmount = 0;
    
    if (currentTimestamp < cliffTimestamp) {
      vestedAmount = 0;
    } else if (currentTimestamp >= endTimestamp) {
      vestedAmount = allocation;
    } else {
      // Linear vesting after cliff
      const timePassedAfterCliff = currentTimestamp - cliffTimestamp;
      const vestingTimeAfterCliff = endTimestamp - cliffTimestamp;
      vestedAmount = allocation * (timePassedAfterCliff / vestingTimeAfterCliff);
    }
    
    return {
      name: contributor.name,
      address: contributor.address,
      percentage: contributor.percentage,
      allocation: allocation.toFixed(2),
      vestedAmount: vestedAmount.toFixed(2),
      vestedPercentage: ((vestedAmount / allocation) * 100).toFixed(2)
    };
  });
  
  return res.json({
    totalAmount,
    vestingDuration,
    cliff,
    startDate,
    endDate: new Date(endTimestamp).toISOString(),
    cliffEndDate: new Date(cliffTimestamp).toISOString(),
    currentProgress: Math.min(100, ((currentTimestamp - startTimestamp) / vestingDurationMs) * 100).toFixed(2),
    schedules
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  return res.json({
    status: 'ok',
    timestamp: new Date(),
    network: process.env.ETHEREUM_NETWORK || 'mainnet'
  });
});

// Fallback route to serve the frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Contract utility functions
const contractUtils = {
  // Deploy a SplitWise contract with the given recipients and shares
  async deployContract(privateKey, recipients, shares) {
    try {
      const account = web3.eth.accounts.privateKeyToAccount(privateKey);
      web3.eth.accounts.wallet.add(account);
      
      const splitwiseContract = new web3.eth.Contract(splitwiseABI);
      
      const deployTransaction = splitwiseContract.deploy({
        data: process.env.CONTRACT_BYTECODE,
        arguments: [recipients, shares]
      });
      
      const gas = await deployTransaction.estimateGas({ from: account.address });
      const gasPrice = await web3.eth.getGasPrice();
      
      const deployedContract = await deployTransaction.send({
        from: account.address,
        gas,
        gasPrice
      });
      
      return deployedContract.options.address;
    } catch (error) {
      console.error('Error in deployContract:', error);
      throw error;
    }
  },
  
  // Calculate the distribution of profits based on shares
  calculateDistribution(totalAmount, shares) {
    const totalShares = shares.reduce((a, b) => a + b, 0);
    return shares.map(share => (totalAmount * share) / totalShares);
  },
  
  // Helper function to format amounts with web3
  formatAmount(amount, decimals = 18) {
    return web3.utils.fromWei(amount.toString(), 'ether');
  }
};

module.exports = app;
