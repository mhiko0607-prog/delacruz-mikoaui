(function () {
    'use strict';

    const apiBase = window.LAVALUST_API_BASE_URL;
    const { createApp, computed, onMounted, reactive, ref } = Vue;

    createApp({
        setup() {
            const accessToken = ref(sessionStorage.getItem('product_access_token') || '');
            const refreshToken = ref(sessionStorage.getItem('product_refresh_token') || '');
            const authenticated = ref(Boolean(accessToken.value || refreshToken.value));
            const authMode = ref('login');
            const authBusy = ref(false);
            const loading = ref(false);
            const saving = ref(false);
            const products = ref([]);
            const currentUser = ref(null);
            const search = ref('');
            const modalOpen = ref(false);
            const editingId = ref(null);
            const errorMessage = ref('');
            const successMessage = ref('');
            const credentials = reactive({ username: '', email: '', password: '' });
            const form = reactive({ product_name: '', description: '', price: '', quantity: '' });

            const filteredProducts = computed(() => {
                const needle = search.value.trim().toLowerCase();
                if (!needle) return products.value;
                return products.value.filter((product) =>
                    [product.product_name, product.description, String(product.id)]
                        .some((value) => String(value || '').toLowerCase().includes(needle))
                );
            });
            const isAdmin = computed(() => currentUser.value?.role === 'admin');

            const inventoryUnits = computed(() =>
                products.value.reduce((total, product) => total + Number(product.quantity || 0), 0)
            );

            const inventoryValue = computed(() =>
                products.value.reduce((total, product) =>
                    total + Number(product.price || 0) * Number(product.quantity || 0), 0
                )
            );

            function saveTokens(tokens) {
                accessToken.value = tokens.access_token;
                refreshToken.value = tokens.refresh_token;
                sessionStorage.setItem('product_access_token', tokens.access_token);
                sessionStorage.setItem('product_refresh_token', tokens.refresh_token);
            }

            function clearSession() {
                accessToken.value = '';
                refreshToken.value = '';
                authenticated.value = false;
                currentUser.value = null;
                products.value = [];
                sessionStorage.removeItem('product_access_token');
                sessionStorage.removeItem('product_refresh_token');
            }

            async function readJson(response) {
                const body = await response.text();
                try {
                    return JSON.parse(body);
                } catch (error) {
                    const status = response.status ? ' (HTTP ' + response.status + ')' : '';
                    if (response.status >= 500) {
                        throw new Error('The API returned a server error' + status + '. Check the database schema and server logs.');
                    }
                    throw new Error('The API returned a non-JSON response' + status + '.');
                }
            }

            async function request(path, options, retried) {
                options = options || {};
                const headers = new Headers(options.headers || {});
                if (options.body && !headers.has('Content-Type')) {
                    headers.set('Content-Type', 'application/json');
                }
                if (!options.skipAuth && accessToken.value) {
                    headers.set('Authorization', 'Bearer ' + accessToken.value);
                }

                let response;
                try {
                    response = await fetch(apiBase + path, {
                        method: options.method || 'GET',
                        headers: headers,
                        body: options.body || undefined
                    });
                } catch (error) {
                    throw new Error('Cannot reach the LavaLust API. Check that the PHP server is running and routing /api requests.');
                }
                const data = await readJson(response);

                if (response.status === 401 && !options.skipAuth && !retried && refreshToken.value) {
                    let refreshResponse;
                    try {
                        refreshResponse = await fetch(apiBase + '/refresh', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ refresh_token: refreshToken.value })
                        });
                    } catch (error) {
                        throw new Error('Cannot reach the LavaLust API to refresh your session.');
                    }
                    const refreshed = await readJson(refreshResponse);
                    if (refreshResponse.ok && refreshed.tokens) {
                        saveTokens(refreshed.tokens);
                        return request(path, options, true);
                    }
                    clearSession();
                    throw new Error(refreshed.error || 'Your session has expired. Please sign in again.');
                }

                if (!response.ok) {
                    throw new Error(data.error || 'The request could not be completed.');
                }
                return data;
            }

            function clearNotices() {
                errorMessage.value = '';
                successMessage.value = '';
            }

            async function loadWorkspace() {
                loading.value = true;
                clearNotices();
                try {
                    currentUser.value = await request('/profile');
                    const response = await request('/products');
                    products.value = response.data || [];
                    authenticated.value = true;
                } catch (error) {
                    errorMessage.value = error.message;
                    if (!accessToken.value && !refreshToken.value) {
                        authenticated.value = false;
                    }
                } finally {
                    loading.value = false;
                }
            }

            async function signIn() {
                authBusy.value = true;
                clearNotices();
                try {
                    const response = await request('/login', {
                        method: 'POST',
                        skipAuth: true,
                        body: JSON.stringify({
                            username: credentials.username,
                            password: credentials.password
                        })
                    });
                    saveTokens(response.tokens);
                    authenticated.value = true;
                    credentials.password = '';
                    await loadWorkspace();
                    return true;
                } catch (error) {
                    errorMessage.value = error.message;
                    return false;
                } finally {
                    authBusy.value = false;
                }
            }

            async function register() {
                authBusy.value = true;
                clearNotices();
                try {
                    await request('/create', {
                        method: 'POST',
                        skipAuth: true,
                        body: JSON.stringify({
                            username: credentials.username,
                            email: credentials.email,
                            password: credentials.password
                        })
                    });
                    authMode.value = 'login';
                    if (await signIn()) {
                        successMessage.value = 'Your account is ready.';
                    }
                } catch (error) {
                    errorMessage.value = error.message;
                } finally {
                    authBusy.value = false;
                }
            }

            async function signOut() {
                clearNotices();
                try {
                    if (refreshToken.value) {
                        await request('/logout', {
                            method: 'POST',
                            skipAuth: true,
                            body: JSON.stringify({ refresh_token: refreshToken.value })
                        });
                    }
                } catch (error) {
                    errorMessage.value = 'Could not contact the server to revoke the session. The local session was cleared.';
                } finally {
                    clearSession();
                    modalOpen.value = false;
                }
            }

            function openCreate() {
                editingId.value = null;
                Object.assign(form, { product_name: '', description: '', price: '', quantity: '' });
                clearNotices();
                modalOpen.value = true;
            }

            function openEdit(product) {
                editingId.value = product.id;
                Object.assign(form, {
                    product_name: product.product_name,
                    description: product.description || '',
                    price: String(product.price),
                    quantity: String(product.quantity)
                });
                clearNotices();
                modalOpen.value = true;
            }

            async function saveProduct() {
                saving.value = true;
                clearNotices();
                const isEditing = editingId.value !== null;
                const payload = JSON.stringify({
                    product_name: form.product_name,
                    description: form.description,
                    price: form.price,
                    quantity: Number(form.quantity)
                });
                try {
                    await request(isEditing ? '/products/' + editingId.value : '/products', {
                        method: isEditing ? 'PUT' : 'POST',
                        body: payload
                    });
                    modalOpen.value = false;
                    await loadWorkspace();
                    successMessage.value = isEditing ? 'Product updated.' : 'Product added.';
                } catch (error) {
                    errorMessage.value = error.message;
                } finally {
                    saving.value = false;
                }
            }

            async function removeProduct(product) {
                if (!window.confirm('Delete "' + product.product_name + '"? This cannot be undone.')) return;
                clearNotices();
                try {
                    await request('/products/' + product.id, { method: 'DELETE' });
                    await loadWorkspace();
                    successMessage.value = 'Product deleted.';
                } catch (error) {
                    errorMessage.value = error.message;
                }
            }

            function formatPrice(price) {
                return new Intl.NumberFormat(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                }).format(Number(price || 0));
            }

            function stockStatus(quantity) {
                if (Number(quantity) === 0) return 'Out of stock';
                if (Number(quantity) <= 5) return 'Low stock';
                return 'In stock';
            }

            onMounted(() => {
                if (authenticated.value) loadWorkspace();
            });

            return {
                authBusy, authMode, authenticated, credentials, currentUser, errorMessage,
                filteredProducts, form, inventoryUnits, inventoryValue, loading, modalOpen,
                products, saving, search, successMessage, editingId, isAdmin, signIn, register, signOut,
                openCreate, openEdit, saveProduct, removeProduct, formatPrice, stockStatus, clearNotices
            };
        },
        template: `
            <main class="shell">
                <header class="topbar">
                    <a class="brand" href="./" aria-label="LavaLust Products home">
                        <span class="brand-mark">L</span>
                        <span>LavaLust <span class="brand-light">/ Products</span></span>
                    </a>
                    <div v-if="authenticated" class="account">
                        <span class="account-avatar">{{ (currentUser?.username || 'U').charAt(0).toUpperCase() }}</span>
                        <span class="account-name">{{ currentUser?.username || 'Account' }}</span>
                        <a v-if="isAdmin" class="button button-quiet button-small" href="https://api-tester.marasigan.dev/" target="_blank" rel="noopener noreferrer">Users management</a>
                        <button class="button button-quiet button-small" type="button" @click="signOut">Log out</button>
                    </div>
                    <span v-else class="secure-label"><span class="secure-dot"></span> Secure workspace</span>
                </header>

                <section v-if="!authenticated" class="auth-layout">
                    <div class="auth-intro">
                        <p class="eyebrow">INVENTORY, UNDER CONTROL</p>
                        <h1>Good products.<br><span>Clear picture.</span></h1>
                        <p class="intro-copy">Keep your catalog organized, track stock at a glance, and make every update count.</p>
                        <div class="intro-note"><span class="note-line"></span> Powered by the LavaLust API</div>
                    </div>
                    <div class="auth-card">
                        <div class="card-heading">
                            <p class="eyebrow">{{ authMode === 'login' ? 'WELCOME BACK' : 'GET STARTED' }}</p>
                            <h2>{{ authMode === 'login' ? 'Sign in to continue' : 'Create your account' }}</h2>
                            <p>{{ authMode === 'login' ? 'Use your account to manage the product catalog.' : 'Registration creates a standard account.' }}</p>
                        </div>
                        <div v-if="errorMessage" class="notice notice-error" role="alert">{{ errorMessage }}</div>
                        <form @submit.prevent="authMode === 'login' ? signIn() : register()">
                            <label for="username">Username</label>
                            <input id="username" v-model.trim="credentials.username" autocomplete="username" required maxlength="100" placeholder="Your username">
                            <template v-if="authMode === 'register'">
                                <label for="email">Email address</label>
                                <input id="email" v-model.trim="credentials.email" type="email" autocomplete="email" required placeholder="you@example.com">
                            </template>
                            <label for="password">Password</label>
                            <input id="password" v-model="credentials.password" type="password" :autocomplete="authMode === 'login' ? 'current-password' : 'new-password'" :minlength="authMode === 'register' ? 8 : 1" required placeholder="Enter your password">
                            <button class="button button-primary button-full" type="submit" :disabled="authBusy">
                                {{ authBusy ? 'Please wait...' : (authMode === 'login' ? 'Sign in' : 'Create account') }}
                                <span v-if="!authBusy" aria-hidden="true">→</span>
                            </button>
                        </form>
                        <p class="auth-switch">
                            {{ authMode === 'login' ? 'New to the workspace?' : 'Already have an account?' }}
                            <button type="button" @click="authMode = authMode === 'login' ? 'register' : 'login'; clearNotices()">
                                {{ authMode === 'login' ? 'Create an account' : 'Sign in' }}
                            </button>
                        </p>
                    </div>
                </section>

                <section v-else class="workspace">
                    <div class="page-heading">
                        <div>
                            <p class="eyebrow">OVERVIEW</p>
                            <h1>Your products</h1>
                            <p class="page-subtitle">A clear view of your catalog and inventory.</p>
                        </div>
                        <button v-if="isAdmin" class="button button-primary" type="button" @click="openCreate"><span class="button-plus">+</span> Add product</button>
                    </div>

                    <div v-if="errorMessage" class="notice notice-error" role="alert">{{ errorMessage }}</div>
                    <div v-if="successMessage" class="notice notice-success" role="status">{{ successMessage }}</div>

                    <div class="stats-grid">
                        <article class="stat-card">
                            <span class="stat-icon stat-icon-purple">P</span>
                            <div><p>Total products</p><strong>{{ products.length }}</strong></div>
                            <span class="stat-caption">in catalog</span>
                        </article>
                        <article class="stat-card">
                            <span class="stat-icon stat-icon-blue">Q</span>
                            <div><p>Units in stock</p><strong>{{ inventoryUnits.toLocaleString() }}</strong></div>
                            <span class="stat-caption">across all products</span>
                        </article>
                        <article class="stat-card">
                            <span class="stat-icon stat-icon-green">V</span>
                            <div><p>Inventory value</p><strong>{{ formatPrice(inventoryValue) }}</strong></div>
                            <span class="stat-caption">price × quantity</span>
                        </article>
                    </div>

                    <section class="catalog-card">
                        <div class="catalog-heading">
                            <div><h2>Product catalog</h2><p>Manage product details and available stock.</p></div>
                            <label class="search-box">
                                <span aria-hidden="true">⌕</span>
                                <input v-model="search" type="search" placeholder="Search products..." aria-label="Search products">
                                <kbd>/</kbd>
                            </label>
                        </div>
                        <div v-if="loading" class="table-state">Loading your catalog...</div>
                        <div v-else-if="!filteredProducts.length" class="empty-state">
                            <span class="empty-icon">P</span>
                            <h3>{{ search ? 'No matching products' : 'Your catalog is ready' }}</h3>
                            <p>{{ search ? 'Try another product name or clear your search.' : 'Add your first product to start tracking your inventory.' }}</p>
                            <button v-if="!search && isAdmin" class="button button-primary" type="button" @click="openCreate">Add your first product</button>
                        </div>
                        <div v-else class="table-wrap">
                            <table>
                                <thead><tr><th>PRODUCT</th><th>DESCRIPTION</th><th>PRICE</th><th>QUANTITY</th><th>STATUS</th><th>ADDED</th><th v-if="isAdmin"><span class="sr-only">Actions</span></th></tr></thead>
                                <tbody>
                                    <tr v-for="product in filteredProducts" :key="product.id">
                                        <td>
                                            <div class="product-cell">
                                                <span class="product-avatar">{{ product.product_name.charAt(0).toUpperCase() }}</span>
                                                <strong>{{ product.product_name }}</strong>
                                            </div>
                                        </td>
                                        <td class="description-cell">{{ product.description || 'No description' }}</td>
                                        <td class="price-cell">{{ formatPrice(product.price) }}</td>
                                        <td>{{ Number(product.quantity).toLocaleString() }}</td>
                                        <td><span class="stock-badge" :class="'stock-' + stockStatus(product.quantity).toLowerCase().replaceAll(' ', '-')">{{ stockStatus(product.quantity) }}</span></td>
                                        <td class="date-cell">{{ product.created_at ? new Date(product.created_at.replace(' ', 'T')).toLocaleDateString() : '—' }}</td>
                                        <td v-if="isAdmin"><div class="row-actions">
                                            <button class="icon-button" type="button" :aria-label="'Edit ' + product.product_name" title="Edit product" @click="openEdit(product)">Edit</button>
                                            <button class="icon-button icon-danger" type="button" :aria-label="'Delete ' + product.product_name" title="Delete product" @click="removeProduct(product)">Delete</button>
                                        </div></td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        <footer v-if="filteredProducts.length" class="catalog-footer">Showing <strong>{{ filteredProducts.length }}</strong> of {{ products.length }} products</footer>
                    </section>
                </section>

                <div v-if="modalOpen && isAdmin" class="modal-backdrop" @click.self="modalOpen = false">
                    <section class="modal-card" role="dialog" aria-modal="true" :aria-labelledby="editingId ? 'edit-title' : 'create-title'">
                        <div class="modal-heading">
                            <div><p class="eyebrow">{{ editingId ? 'UPDATE CATALOG' : 'NEW INVENTORY' }}</p><h2 :id="editingId ? 'edit-title' : 'create-title'">{{ editingId ? 'Edit product' : 'Add a product' }}</h2></div>
                            <button class="modal-close" type="button" aria-label="Close" @click="modalOpen = false">×</button>
                        </div>
                        <form @submit.prevent="saveProduct">
                            <label for="product-name">Product name <span class="required">*</span></label>
                            <input id="product-name" v-model.trim="form.product_name" maxlength="100" required placeholder="e.g. Studio headphones">
                            <label for="product-description">Description</label>
                            <textarea id="product-description" v-model="form.description" rows="3" placeholder="Add a short description"></textarea>
                            <div class="form-row">
                                <div><label for="product-price">Price <span class="required">*</span></label><input id="product-price" v-model="form.price" type="number" min="0" max="99999999.99" step="0.01" required placeholder="0.00"></div>
                                <div><label for="product-quantity">Quantity <span class="required">*</span></label><input id="product-quantity" v-model="form.quantity" type="number" min="0" max="2147483647" step="1" required placeholder="0"></div>
                            </div>
                            <div v-if="errorMessage" class="notice notice-error" role="alert">{{ errorMessage }}</div>
                            <div class="modal-actions">
                                <button class="button button-quiet" type="button" @click="modalOpen = false">Cancel</button>
                                <button class="button button-primary" type="submit" :disabled="saving">{{ saving ? 'Saving...' : (editingId ? 'Save changes' : 'Add product') }}</button>
                            </div>
                        </form>
                    </section>
                </div>
                <footer class="app-footer">Product Management <span>·</span> Your catalog, in one place</footer>
            </main>
        `
    }).mount('#app');
}());
