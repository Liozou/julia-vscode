import * as path from 'path'
import * as vscode from 'vscode'
import * as rpc from 'vscode-jsonrpc/node'
import { g_connection } from './repl'

const requestTypeGetTableData = new rpc.RequestType<{
    id: string,
    startRow: Number,
    endRow: Number
}, string, void>('repl/getTableData')
const clearLazyTable = new rpc.NotificationType<{
    id: string
}>('repl/clearLazyTable')

export function displayTable(payload, context, isLazy = false) {
    const panel = vscode.window.createWebviewPanel('jlgrid', 'Julia Table', {
        preserveFocus: true,
        viewColumn: vscode.ViewColumn.Active
    }, {
        enableScripts: true,
        retainContextWhenHidden: true
    })

    const uriAgGrid = panel.webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'libs', 'ag-grid', 'ag-grid.js')))
    const uriAgGridCSS = panel.webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'libs', 'ag-grid', 'ag-grid.css')))
    const theme = vscode.window.activeColorTheme.kind === 1 ? '' : '-dark'
    const uriAgGridThemeCSS = panel.webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'libs', 'ag-grid', `ag-grid-balham${theme}.css`)))

    let script

    if (isLazy) {
        const jPayload = JSON.parse(payload)
        const objectId = jPayload.id

        panel.onDidDispose(() => {
            g_connection.sendNotification(
                clearLazyTable,
                {
                    id: objectId
                }
            )
        })

        panel.webview.onDidReceiveMessage(async (message) => {
            if (message.type === 'getRows') {
                const data = await g_connection.sendRequest(
                    requestTypeGetTableData,
                    {
                        id: objectId,
                        startRow: message.content.startRow,
                        endRow: message.content.endRow
                    }
                )

                panel.webview.postMessage({
                    type: 'getRows',
                    id: message.id,
                    data: data
                })
            } else {
                console.error('invalid message received: ', message)
            }
        })
        script = `
            <script type="text/javascript">
                const vscodeAPI = acquireVsCodeApi()

                const requests = {}
                const payload = ${payload};

                function getRows({startRow, endRow, context, successCallback, failCallback}) {
                    const id  = Math.random()
                    vscodeAPI.postMessage({
                        type: 'getRows',
                        id: id,
                        content: {
                            startRow, endRow
                        }
                    })
                    requests[id] = {
                        success: successCallback,
                        failure: failCallback
                    }
                }
                let didResize = false
                window.addEventListener('message', event => {
                    const message = event.data

                    if (message.type === 'getRows') {
                        const callback = requests[message.id]
                        if (callback !== undefined) {
                            if (message.data.error) {
                                callback.failure()
                            } else {
                                callback.success(message.data.rows, message.data.lastRow)
                                if (!didResize) {
                                    didResize = true
                                    gridOptions.columnApi.autoSizeAllColumns()
                                }
                            }
                            delete requests[message.id]
                        }
                    } else {
                        console.error('invalid message received: ', message)
                    }
                })
                const gridOptions = {
                    columnDefs: payload.coldefs,
                    maxConcurrentDatasourceRequests: 1,
                    cacheBlockSize: 1000,
                    maxBlocksInCache: 100,
                    rowModelType: 'infinite',
                    rowSelection: 'multiple',
                    enableCellTextSelection: true, // to ensure copy events work as expected; text selection is disabled with user-select: none
                    datasource: {
                        getRows,
                        rowCount: payload.rowCount
                    },
                    components: {
                        rowNumberRenderer: RowNumberRenderer
                    },
                    onFirstDataRendered: event => setTimeout(event.columnApi.autoSizeAllColumns(undefined, false), 200)
                };
                const eGridDiv = document.querySelector('#myGrid');
                new agGrid.Grid(eGridDiv, gridOptions);
            </script>
        `
    } else {
        script = `
            <script type="text/javascript">
                const payload = ${payload};
                const gridOptions = {
                    columnDefs: payload.coldefs,
                    rowData: payload.data,
                    rowSelection: 'multiple',
                    enableCellTextSelection: true,
                    components: {
                        rowNumberRenderer: RowNumberRenderer
                    },
                    onFirstDataRendered: event => event.columnApi.autoSizeAllColumns()
                };
                const eGridDiv = document.querySelector('#myGrid');
                new agGrid.Grid(eGridDiv, gridOptions);
            </script>
        `
    }

    panel.webview.html = `
        <html>
            <head>
                <script src="${uriAgGrid}"></script>
                <link rel="stylesheet" href="${uriAgGridCSS}">
                <link rel="stylesheet" href="${uriAgGridThemeCSS}">
                <style type="text/css">
                .row-number {
                    opacity: 0.3;
                    transition: opacity .1s ease-in-out;
                    font-family: var(--vscode-editor-font-family);
                    user-select: none;
                }
                .ag-row-hover .row-number {
                    opacity: 1;
                }
                .ag-cell-value {
                    -moz-user-select: none!important;
                    -webkit-user-select: none!important;
                    -ms-user-select: none!important;
                    user-select: none!important;
                }
                .ag-root-wrapper {
                    border: 0!important;
                }
                #myGrid {
                    --ag-header-background-color: var(--vscode-panelSectionHeader-background);
                    --ag-background-color: var(--vscode-panel-background);
                    --ag-odd-row-background-color: rgba(120, 120, 120, 0.03);
                    --ag-row-hover-color: var(--vscode-list-hoverBackground);
                    --ag-header-foreground-color: var(--vscode-foreground);
                    --ag-foreground-color: var(--vscode-foreground);
                    --ag-row-border-color: var(--vscode-panel-border);
                    --ag-border-color: var(--vscode-panel-border);
                    --ag-range-selection-border-color: var(--vscode-inputValidation-infoBorder);
                    --ag-selected-row-background-color: var(--vscode-editor-selectionBackground);
                }
                </style>
            </head>
            <body style="padding:0;">
                <div id="myGrid" style="height: 100vh; width: 100vw;" class="ag-theme-balham${theme}"></div>
            </body>
            <script type="text/javascript">
                function RowNumberRenderer() {}

                RowNumberRenderer.prototype.init = function (params) {
                    this.eGui = document.createElement('span');
                    this.eGui.classList.add('row-number');
                    this.eGui.innerHTML = params.rowIndex + 1;
                };

                RowNumberRenderer.prototype.getGui = function() {
                    return this.eGui;
                };
            </script>
            ${script}
            <script type="text/javascript">
                eGridDiv.addEventListener('copy', ev => {
                    const nodes = gridOptions.api.getSelectedNodes()
                    const text = nodes.map(n => Object.values(n.data).join('\\t')).join('\\n')
                    ev.clipboardData.setData('text/plain', text);
                    ev.preventDefault();
                })
            </script>
        </html>
        `
}
