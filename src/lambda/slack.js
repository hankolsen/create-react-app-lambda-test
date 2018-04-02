const fetch = require('node-fetch');
const slackURL = process.env.SLACK_WEBHOOK_URL;
const IdentityApi = require('../identity/Identity');

function fetchUser(identity, id) {
    const api = new IdentityApi(identity.url, identity.token);
    return api.request(`/admin/users/${id}`);
}

function updateUser(identity, user, app_metadata) {
    const api = new IdentityApi(identity.url, identity.token);
    const new_app_metadata = {
        ...user.app_metadata,
        ...app_metadata
    };

    return api.request(`/admin/users/${user.id}`, {
        method: 'PUT',
        body: JSON.stringify({ app_metadata: new_app_metadata })
    });
}

const oneHour = (60 * 60 * 1000);

export function handler(event, context, callback) {
    if (event.httpMethod !== 'POST') {
        return callback(null, { statusCode: 410, body: 'Unsupported Request' });
    }
    
    const claims = context.clientContext && context.clientContext.user;
    if (!claims) {
        return callback(null, { statusCode: 401, body: 'You must be signed in.'})
    }

    fetchUser(context.clientContext.identity, claims.sub)
    .then((user) => {
        const lastMessage = new Date(user.app_metadata.last_message_at || 0).getTime();
        const cutOff = new Date().getTime() - oneHour;
        if (lastMessage > cutOff) {
            return callback(null, statusCode: 401, body: 'Only one message per hour');
        }
        
        try {
            const payload = JSON.parse(event.body);
            
            fetch(slackURL, {
                method: 'POST',
                body: JSON.stringify({ 
                    text: payload.text,
                    attachments: [
                        { 'text': `From ${claims.email}`}
                    ] 
                })
            })
            .then(() => {
                updateUser(context.clientContext.IdentityApi, user, { last_message_at: new Date().getTime() })
            })
            .then(() => {
                callback(null, { statusCode: 204 });
            })
            .catch((e) => {
                callback(null, { statusCode: 500, body: `Internal Server Error: ${e}`});
            });
        } catch(e) {
            callback(null, { statusCode: 500, body: `Internal Server Error: ${e}`});
        }
    });

}