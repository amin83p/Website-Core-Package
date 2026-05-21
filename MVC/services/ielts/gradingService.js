// MVC/services/ielts/gradingService.js

const gradingService = {

    /**
     * Calculates the Band Score range based on Yes/No constraints
     * @param {Array} answers - The array of answers from the session
     * @param {Object} assessmentDef - The original assessment definition (to get the rules)
     */
    calculateScore: (answers, assessmentDef) => {
        
        // Default Range: 0 to 9
        let minScore = 0.0;
        let maxScore = 9.0;
        let logs = []; // To explain why the score is what it is

        // We map answers to their definitions to find the rules
        answers.forEach((ans, index) => {
            // Find the rule for this question
            const rule = assessmentDef.questions.find(q => q.id === ans.questionId || q.order === ans.order);
            
            if (!rule) return;

            const userSaidYes = ans.userAnswer && ans.userAnswer.toLowerCase() === 'yes';
            const userSaidNo = ans.userAnswer && ans.userAnswer.toLowerCase() === 'no';

            // LOGIC 1: YES -> Raises the Floor (You met a criteria for a higher band)
            if (userSaidYes && rule.if_yes_band_floor) {
                const floor = parseFloat(rule.if_yes_band_floor);
                if (floor > minScore) {
                    minScore = floor;
                    logs.push(`Q${index+1} (Yes): Raised min score to ${minScore}`);
                }
            }

            // LOGIC 2: NO -> Lowers the Ceiling (You failed a criteria, capping your score)
            if (userSaidNo && rule.if_no_band_ceiling) {
                const ceiling = parseFloat(rule.if_no_band_ceiling);
                if (ceiling < maxScore) {
                    maxScore = ceiling;
                    logs.push(`Q${index+1} (No): Capped max score at ${maxScore}`);
                }
            }
        });

        // Final Validation
        if (minScore > maxScore) {
            // Conflict: User answered "Yes" to a hard question but "No" to an easy one?
            return {
                band: "Inconsistent",
                min: minScore,
                max: maxScore,
                feedback: `Contradictory answers. Your 'Yes' answers imply at least ${minScore}, but your 'No' answers limit you to ${maxScore}.`,
                logs
            };
        }

        return {
            band: minScore === maxScore ? `${minScore}` : `${minScore} - ${maxScore}`,
            min: minScore,
            max: maxScore,
            feedback: `Based on your checklist, your essay falls between Band ${minScore} and ${maxScore}.`,
            logs
        };
    }
};

module.exports = gradingService;