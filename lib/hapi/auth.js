/**
 *    Copyright 2016 floragunn GmbH

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

 http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */

import Boom from 'boom';
import {assign} from 'lodash';

export default function (pluginRoot, server, APP_ROOT, API_ROOT) {
    const config = server.config();
    const basePath = config.get('server.basePath');
    const AuthenticationError = pluginRoot('lib/auth/authentication_error');
    const sessionTTL = config.get('searchguard.session.ttl');
    const cookieConfig = {
      password: config.get('searchguard.cookie.password'),
      cookie: config.get('searchguard.cookie.name'),
      isSecure: config.get('searchguard.cookie.secure'),
      validateFunc: pluginRoot('lib/session/validate')(server),
      ttl: config.get('searchguard.cookie.ttl')
    };

    server.auth.strategy('sg_access_control_cookie', 'cookie', false, cookieConfig);

    server.auth.scheme('sg_access_control_scheme', (server, options) => ({
        authenticate: (request, reply) => {
            server.auth.test('sg_access_control_cookie', request, (error, credentials) => {
                if (error) {
                    if(request.query.username && request.query.password){
                        let userFromQueryString = {
                            username: request.query.username,
                            password: request.query.password
                        };
                        server.plugins.searchguard.getAuthenticationBackend().authenticate(userFromQueryString).then(function (user) {
                            let session = {
                                username: user.username,
                                credentials: user.credentials,
                                proxyCredentials: user.proxyCredentials
                            };
                            if (sessionTTL) {
                                session.expiryTime = Date.now() + sessionTTL;
                            }
                            request.auth.session.set(session);
                            return reply.redirect(request.url.path);
                        });

                    }
                    else if (request.url.path.indexOf(API_ROOT) === 0 || request.method !== 'get') {
                        return reply(Boom.forbidden(error));
                    } else {
                        return reply.redirect(`${basePath}${APP_ROOT}/login`);
                    }
                }else {
                    reply.continue({credentials});
                }

            });
        }
    }));

    server.auth.strategy('sg_access_control', 'sg_access_control_scheme', true);

    server.ext('onPostAuth', function (request, next) {

        if (request.auth && request.auth.isAuthenticated) {
            const backend = server.plugins.searchguard.getAuthenticationBackend();
            return backend.getAuthHeaders(request.auth.credentials)
                .then((headers) => {
                    assign(request.headers, headers);
                    return next.continue();
                })
                .catch((error) => {
                    server.log(['searchguard', 'error'], `An error occurred while computing auth headers, clearing session: ${error}`);
                    request.auth.session.clear();
                    // redirect to login somehow?
                    return next.continue();
                });
        }
        return next.continue();
    });

}
