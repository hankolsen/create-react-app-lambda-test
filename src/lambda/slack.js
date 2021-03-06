const fetch = require('node-fetch');
const slackURL = process.env.SLACK_WEBHOOK_URL;

class IdentityApi {
    constructor(apiURL, token) {
        this.apiURL = apiURL;
        this.token = token;
    }

    headers(headers = {}) {
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.token}`,
            ...headers
        };
    }

    parseJsonResponse(response) {
        return response.json().then(json => {
            if (!response.ok) {
                return Promise.reject({ status: response.status, json });
            }

            return json;
        });
    }

    request(path, options = {}) {
        const headers = this.headers(options.headers || {});
        return fetch(this.apiURL + path, { ...options, headers })
        .then((response) => {
            const contentType = response.headers.get('Content-Type');
            if (contentType && contentType.match(/json/)) {
                return this.parseJsonResponse(response);
            }

            if (!response.ok) {
                return response.text().then(data => {
                    return Promise.reject({ status: response.status, data });
                });
            }

            return response.text().then(data => {
                data;
            });
        });
    }
}

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
            return callback(null, { statusCode: 401, body: 'Only one message per hour' });
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
                updateUser(context.clientContext.identity, user, { last_message_at: new Date().getTime() })
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