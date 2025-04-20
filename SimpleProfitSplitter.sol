// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IERC20 {
    function transfer(address recipient, uint amount) external returns (bool);
    function balanceOf(address account) external view returns (uint);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
}

contract SimpleProfitSplitter {
    address public owner;
    address public pendingOwner;
    IERC20 public token;
    
    // Use a fixed point system for percentages - 10000 = 100%
    uint256 public constant PERCENTAGE_DENOMINATOR = 10000;
    bool private locked; // Reentrancy guard

    struct Beneficiary {
        uint256 share; // in basis points (1/100 of percent, so 10000 = 100%)
        uint256 withdrawn;
        bool exists;
    }

    mapping(address => Beneficiary) public beneficiaries;
    address[] public members;
    uint256 public totalShares;

    event BeneficiaryAdded(address indexed user, uint256 share);
    event BeneficiaryRemoved(address indexed user);
    event SharesUpdated(address indexed user, uint256 newShare);
    event TokensWithdrawn(address indexed user, uint256 amount);
    event OwnershipTransferInitiated(address indexed currentOwner, address indexed newOwner);
    event OwnershipTransferCompleted(address indexed previousOwner, address indexed newOwner);
    event EmergencyWithdrawal(address token, address recipient, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "SimpleProfitSplitter: caller is not the owner");
        _;
    }

    modifier nonReentrant() {
        require(!locked, "SimpleProfitSplitter: reentrant call");
        locked = true;
        _;
        locked = false;
    }

    constructor(address _token) {
        require(_token != address(0), "SimpleProfitSplitter: token cannot be zero address");
        owner = msg.sender;
        token = IERC20(_token);
    }

    /**
     * @dev Initiates ownership transfer to a new address
     * @param newOwner The address to transfer ownership to
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "SimpleProfitSplitter: new owner is the zero address");
        pendingOwner = newOwner;
        emit OwnershipTransferInitiated(owner, newOwner);
    }

    /**
     * @dev Accepts ownership transfer
     */
    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "SimpleProfitSplitter: caller is not the pending owner");
        emit OwnershipTransferCompleted(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    /**
     * @dev Adds a new beneficiary
     * @param _user Address of the beneficiary
     * @param _share Share in basis points (1/100 of percent, 10000 = 100%)
     */
    function addBeneficiary(address _user, uint256 _share) public onlyOwner {
        require(_user != address(0), "SimpleProfitSplitter: beneficiary cannot be zero address");
        require(!beneficiaries[_user].exists, "SimpleProfitSplitter: beneficiary already exists");
        require(_share > 0, "SimpleProfitSplitter: share must be greater than zero");
        require(totalShares + _share <= PERCENTAGE_DENOMINATOR, "SimpleProfitSplitter: total shares exceed 100%");
        
        beneficiaries[_user] = Beneficiary(_share, 0, true);
        members.push(_user);
        totalShares += _share;
        
        emit BeneficiaryAdded(_user, _share);
    }

    /**
     * @dev Updates an existing beneficiary's share
     * @param _user Address of the beneficiary
     * @param _newShare New share in basis points
     */
    function updateBeneficiaryShare(address _user, uint256 _newShare) public onlyOwner {
        require(beneficiaries[_user].exists, "SimpleProfitSplitter: beneficiary does not exist");
        require(_newShare > 0, "SimpleProfitSplitter: share must be greater than zero");
        
        uint256 oldShare = beneficiaries[_user].share;
        uint256 newTotalShares = totalShares - oldShare + _newShare;
        require(newTotalShares <= PERCENTAGE_DENOMINATOR, "SimpleProfitSplitter: total shares exceed 100%");
        
        beneficiaries[_user].share = _newShare;
        totalShares = newTotalShares;
        
        emit SharesUpdated(_user, _newShare);
    }

    /**
     * @dev Removes a beneficiary
     * @param _user Address of the beneficiary to remove
     */
    function removeBeneficiary(address _user) public onlyOwner {
        require(beneficiaries[_user].exists, "SimpleProfitSplitter: beneficiary does not exist");
        
        // Force withdraw any remaining tokens
        _withdrawFor(_user);
        
        totalShares -= beneficiaries[_user].share;
        
        // Remove from members array
        for (uint i = 0; i < members.length; i++) {
            if (members[i] == _user) {
                members[i] = members[members.length - 1];
                members.pop();
                break;
            }
        }
        
        delete beneficiaries[_user];
        emit BeneficiaryRemoved(_user);
    }

    /**
     * @dev Internal function to calculate and transfer tokens to a beneficiary
     * @param _user Address of the beneficiary
     * @return payout Amount of tokens transferred
     */
    function _withdrawFor(address _user) internal returns (uint256 payout) {
        Beneficiary storage b = beneficiaries[_user];
        require(b.exists, "SimpleProfitSplitter: not a beneficiary");

        uint256 totalBalance = token.balanceOf(address(this));
        if (totalBalance == 0) return 0;
        
        // If totalShares is 0, we cannot distribute
        require(totalShares > 0, "SimpleProfitSplitter: total shares are zero");
        
        uint256 totalEntitled = (totalBalance + b.withdrawn) * b.share / totalShares;
        payout = totalEntitled - b.withdrawn;
        
        if (payout > 0) {
            b.withdrawn += payout;
            require(token.transfer(_user, payout), "SimpleProfitSplitter: token transfer failed");
            emit TokensWithdrawn(_user, payout);
        }
        
        return payout;
    }

    /**
     * @dev Allows a beneficiary to withdraw their entitled tokens
     */
    function withdraw() public nonReentrant {
        uint256 payout = _withdrawFor(msg.sender);
        require(payout > 0, "SimpleProfitSplitter: nothing to withdraw");
    }

    /**
     * @dev Allows the owner to withdraw on behalf of a beneficiary
     * @param _user Address of the beneficiary
     */
    function withdrawFor(address _user) public onlyOwner nonReentrant {
        _withdrawFor(_user);
    }

    /**
     * @dev Allows the owner to distribute profits to all beneficiaries at once
     */
    function distributeToAll() public onlyOwner nonReentrant {
        for (uint i = 0; i < members.length; i++) {
            _withdrawFor(members[i]);
        }
    }

    /**
     * @dev Emergency function to withdraw any tokens accidentally sent to this contract
     * @param _token Address of the token to withdraw
     * @param _amount Amount to withdraw
     */
    function emergencyWithdraw(address _token, uint256 _amount) public onlyOwner nonReentrant {
        require(_token != address(token), "SimpleProfitSplitter: cannot withdraw the managed token");
        
        IERC20 tokenToWithdraw = IERC20(_token);
        uint256 balance = tokenToWithdraw.balanceOf(address(this));
        uint256 amountToWithdraw = _amount == 0 || _amount > balance ? balance : _amount;
        
        require(tokenToWithdraw.transfer(owner, amountToWithdraw), "SimpleProfitSplitter: emergency withdraw failed");
        emit EmergencyWithdrawal(_token, owner, amountToWithdraw);
    }

    /**
     * @dev Calculates the amount a beneficiary can withdraw
     * @param _user Address of the beneficiary
     * @return The claimable amount
     */
    function viewPayout(address _user) public view returns (uint256) {
        Beneficiary memory b = beneficiaries[_user];
        if (!b.exists || totalShares == 0) return 0;
        
        uint256 totalBalance = token.balanceOf(address(this));
        uint256 totalEntitled = (totalBalance + b.withdrawn) * b.share / totalShares;
        return totalEntitled - b.withdrawn;
    }

    /**
     * @dev Returns the list of all beneficiaries
     * @return Array of beneficiary addresses
     */
    function getMembers() public view returns (address[] memory) {
        return members;
    }

    /**
     * @dev Checks if an address is a beneficiary
     * @param _user Address to check
     * @return True if the address is a beneficiary
     */
    function isBeneficiary(address _user) public view returns (bool) {
        return beneficiaries[_user].exists;
    }
}
