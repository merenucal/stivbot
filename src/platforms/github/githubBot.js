const { AbstractBot } = require('../abstract/abstractBot');
const { TrueFalseMatcher } = require("../../lib/matcher");
const { GithubParser } = require('./githubParser');
const { GithubBuilder } = require('./githubBuilder');
const { Advice } = require('../abstract/advice');
const { Action } = require('../abstract/action');
const LOCALE = require('../../locale');

class GithubBot extends AbstractBot {

    /*bind() {
        app.post('/new_issue', (req, res) => {
            this.newIssue(context);
        });

        app.post('/issue_edited', (req, res) => {
            this.issueEdited(context);
        });
    }*/

    async newIssue(context) {
        // https://octokit.github.io/rest.js/v19#issues-create-comment
        /*await context.octokit.issues.createComment(
            context.issue({ body: LOCALE.GITHUB.get("github.new.1")})
        );*/
        
        await this.issueEdited(context); //Temporary bypass until reaction webhooks are implemented
    }

    async reactionToComment(context) {        
        //TODO - Reaction webhook not available yet

        //If reaction is thumb up
            // Get issue
            let issue = await this.#getIssue(context);

            //Parse the issue
            const parser = new GithubParser(issue);
            const idea = parser.parse(issue);
        //Else if reaction is thumb down
            //Remove bot comment
    }

    async issueEdited(context) {
        // https://octokit.github.io/rest.js/v19#issues-list-comments

        // Get repo
        let repo = await this.#getRepo(context);

        // Get issue
        let issue = await this.#getIssue(context);

        console.log(`Issue ${issue.data.html_url} edited`);

        //Parse the issue
        const parser = new GithubParser(issue);
        const idea = parser.parse(issue);

        //Fetch idea from database
        await idea.fetch();

        console.log(`Id: ${idea.id}`);
        console.log(`Current state: ${idea.state}`);
        console.log(`Sections: ${Object.keys(idea.sections)}`);

        //Compute the appropriate anwser for the current idea
        const response = await this.compute(idea);

        if (response != null) {
            //Build answer
            const builder = new GithubBuilder(idea, response.advice, response.action, repo);
            const markdown = builder.build();

            //Save idea in database
            await idea.save();

            // Get the bot message
            const comment = await this.#getBotComment(context);
            
            if (comment == null) {
                return await context.octokit.issues.createComment(
                    context.issue({ body: markdown})
                );
            }
            else {
                //Edit first bot message
                return await context.octokit.issues.updateComment(
                    context.repo({
                        comment_id: comment.id,
                        body: markdown,
                    })
                );
            }
        }
        else {
            console.log("Nothing to do!");
        }
    }

    async #getIssue(context) {
        return await context.octokit.issues.get(context.issue());
    }

    async #getRepo(context) {
        return await context.octokit.repos.get(context.issue());
    }

    async #getBotComment(context) {
        //Get the app
        let app = await context.octokit.apps.getAuthenticated();

        // Get first bot message
        let comment = null;
        let comments = await context.octokit.issues.listComments(context.issue());
        for (const c of comments.data) {
            if (`${app.data.name}[bot]` == c.user.login) {
                comment = c;
            }
        }
        return comment;
    }

    async stateUnstructured(idea) {
        var advice = null;
        var action = null;
        const matcher = new TrueFalseMatcher();

        //Fisrt request to OpenAI
        const conversation_openai_1 = await this.openAi.request(LOCALE.GITHUB.get("github.unstructured.openai.1").format(idea.body));

        //If response is False
        if (!matcher.get(conversation_openai_1.getLastMessage())) {
            advice = new Advice(LOCALE.GITHUB.get("github.unstructured.advice.1"));
            action = new Action(LOCALE.GITHUB.get("github.unstructured.action.1"));
        }
        //If response is True
        else {
            //Second request to AI
            const conversation_openai_2 = await this.openAi.request(LOCALE.GITHUB.get("github.unstructured.openai.2").format(idea.body));
            //If response is False
            if (!matcher.get(conversation_openai_2.getLastMessage())) {
                //Third request to AI
                const conversation_openai_3 = await this.openAi.request(LOCALE.GITHUB.get("github.unstructured.openai.3").format(idea.body));
                advice = new Advice(LOCALE.GITHUB.get("github.unstructured.advice.2"), conversation_openai_3.getLastMessage());
                action = new Action(LOCALE.GITHUB.get("github.unstructured.action.2"));
            }
            //If response is True
            else {
                //Fourth request to OpenAI
                const conversation_openai_4 = await this.openAi.request(LOCALE.GITHUB.get("github.unstructured.openai.4").format(idea.body));
                advice = new Advice(LOCALE.GITHUB.get("github.unstructured.advice.3"), conversation_openai_4.getLastMessage());
                action = new Action(LOCALE.GITHUB.get("github.unstructured.action.3"), conversation_openai_4.getLastMessage());
                idea.state = STATE.P;
            }
        }
        return {advice, action};
    }

    async stateP(idea) {
        //Fisrt request to OpenAI
        const conversation_openai_1 = await this.openAi.request(LOCALE.GITHUB.get("github.p.openai.1").format(idea.sections.problematic));

        //Second request to OpenAI
        const conversation_openai_2 = await this.openAi.request(LOCALE.GITHUB.get("github.p.openai.2"), conversation_openai_1);

        const advice = new Advice(LOCALE.GITHUB.get("github.p.advice.1"), conversation_openai_2.getLastMessage());
        const action = new Action(LOCALE.GITHUB.get("github.p.action.1"));
        idea.state = STATE.PS;

        return {advice, action};
    }

    async statePS(idea) {
        //First request to OpenAI
        const conversation_openai_1 = await this.openAi.request(LOCALE.GITHUB.get("github.ps.openai.1").format(idea.body));

        const advice = new Advice(LOCALE.GITHUB.get("github.ps.advice.1"), conversation_openai_1.getLastMessage());
        const action = new Action(LOCALE.GITHUB.get("github.ps.action.1"), conversation_openai_1.getLastMessage());
        idea.state = STATE.NONE;

        return {advice, action};
    }
}

module.exports = {
    GithubBot
}
