const NodeHelper = require("node_helper");
const axios = require("axios");
const { createPublicClient, http } = require('viem');
const { mainnet } = require('viem/chains');

// Sleep function for retry
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Retry function
const retry = async (fn, retries = 3, delay = 1000) => {
    let lastError;
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (error) {
            console.log(`Attempt ${i + 1} failed, retrying in ${delay}ms...`);
            lastError = error;
            await sleep(delay);
            delay *= 2; // Exponential backoff
        }
    }
    throw lastError;
};

// Helper function to truncate address
const truncateAddress = (address) => {
    return address.substring(0, 6) + "..." + address.substring(address.length - 4);
};

module.exports = NodeHelper.create({
    start: function() {
        console.log("Starting node helper for: " + this.name);
        this.client = createPublicClient({
            chain: mainnet,
            transport: http('https://eth.llamarpc.com')
        });
        
        // Define the contract ABI for the proposalCount function
        this.nounsGovAbi = [{ 
            name: 'proposalCount', 
            type: 'function', 
            stateMutability: 'view', 
            inputs: [], 
            outputs: [{ type: 'uint256' }] 
        }];
        
        // Nouns governance contract address
        this.nounsGovAddress = '0x6f3e6272a167e8accb32072d08e0957f9c79223d';
    },

    socketNotificationReceived: async function(notification, payload) {
        if (notification === "FETCH_PROPOSAL_DATA") {
            try {
                // First get the latest proposal ID from the blockchain
                const latestId = await this.getLatestProposalId();
                if (!latestId) {
                    throw new Error("Failed to retrieve the latest proposal ID");
                }
                
                // Determine how many proposals to fetch, default to 10 if not specified
                const numToFetch = payload.maxProposals || 10;
                console.log(`Fetching ${numToFetch} proposals for MMM-NounsProposal, starting from ID ${latestId}`);
                
                // Fetch proposals starting from the latest ID
                const proposals = await this.fetchProposalBatch(latestId, numToFetch);
                
                // Update the UI with the fetched proposals
                this.sendSocketNotification("PROPOSAL_DATA_RESULT", {
                    data: proposals
                });
            } catch (error) {
                console.error("Error fetching data:", error);
                this.sendSocketNotification("PROPOSAL_DATA_RESULT", {
                    error: error.message
                });
            }
        }
    },

    getLatestProposalId: async function() {
        try {
            console.log("Fetching latest proposal ID from contract...");
            
            // Use retry to handle potential network issues
            const count = await retry(() => this.client.readContract({
                address: this.nounsGovAddress,
                abi: this.nounsGovAbi,
                functionName: 'proposalCount'
            }));
            
            const idValue = parseInt(count.toString());
            console.log(`Retrieved latest proposal ID: ${idValue}`);
            return idValue;
        } catch (error) {
            console.error('Error getting proposal count:', error);
            return null;
        }
    },

    fetchProposalBatch: async function(startId, numToFetch) {
        console.log(`Starting batch fetch from ID ${startId}, requesting ${numToFetch} proposals`);
        const proposals = [];
        let currentId = startId;
        let attemptsRemaining = numToFetch + 20; // Additional attempts to ensure we get enough proposals
        
        // Continue fetching until we have enough proposals or run out of attempts
        while (proposals.length < numToFetch && attemptsRemaining > 0) {
            try {
                console.log(`Fetching proposal #${currentId}...`);
                const data = await this.fetchProposalData(currentId);
                
                if (data) {
                    console.log(`Successfully fetched proposal #${currentId}: ${data.title}`);
                    proposals.push(data);
                } else {
                    console.log(`Skipped proposal #${currentId} (no data returned)`);
                }
            } catch (error) {
                console.error(`Failed to fetch proposal #${currentId}:`, error.message);
            }
            
            // Move to the previous proposal and decrease attempts counter
            currentId--;
            attemptsRemaining--;
            
            // Short delay to avoid rate limiting
            await sleep(200);
        }
        
        console.log(`Fetched ${proposals.length}/${numToFetch} proposals after trying ${numToFetch + 20 - attemptsRemaining} IDs`);
        
        return proposals.slice(0, numToFetch);
    },

    fetchProposalData: async function(proposalId) {
        try {
            // Set a timeout to avoid hanging requests
            const response = await axios.get(`https://api.nouns.biz/proposal/${proposalId}`, {
                timeout: 5000
            });
            
            const data = response.data;
            
            // Calculate vote statistics
            const votes = data.votes || [];
            const forVotes = votes.filter(v => v.support === 'FOR').reduce((sum, v) => sum + v.votes, 0);
            const againstVotes = votes.filter(v => v.support === 'AGAINST').reduce((sum, v) => sum + v.votes, 0);
            const abstainVotes = votes.filter(v => v.support === 'ABSTAIN').reduce((sum, v) => sum + v.votes, 0);
            
            // Get proposer ENS name
            let proposerDisplay = '';
            if (data.proposer) {
                try {
                    const ensName = await retry(() => this.client.getEnsName({ 
                        address: data.proposer 
                    }));
                    
                    if (ensName) {
                        // If we have an ENS name, just use that
                        proposerDisplay = ensName;
                    } else {
                        // If no ENS name, just use the truncated address
                        proposerDisplay = truncateAddress(data.proposer);
                    }
                } catch (ensError) {
                    // In case of error with ENS, fall back to truncated address
                    proposerDisplay = truncateAddress(data.proposer);
                }
            } else {
                proposerDisplay = 'Anonymous';
            }

            // Prepare the data for the frontend
            return {
                title: data.title || `Proposal ${proposalId}`,
                proposalId: proposalId,
                proposerDisplay: proposerDisplay,
                quorumVotes: data.quorumVotes || 0,
                status: data.status || { currentStatus: 'UNKNOWN' },
                forVotes: forVotes,
                againstVotes: againstVotes,
                abstainVotes: abstainVotes
            };
            
        } catch (error) {
            console.error(`Error fetching proposal ${proposalId}:`, error.message);
            return null;
        }
    }
}); 