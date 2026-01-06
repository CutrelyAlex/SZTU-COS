// ==UserScript==
// @name         自动学生评教
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  自动完成学生评教，除最后一项外全选"同意"，最后一项选"大体同意"，并填写"教学优秀"
// @author       NekoD
// @match        https://ddpj-sztu-edu-cn-s.webvpn.sztu.edu.cn:8118/index.html*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // 全局状态变量
    const state = {
        step: 0,
        totalSteps: 6,
        isEvaluationPage: false,
        foundItems: 0,
        selectedRadios: 0,
        textareaFilled: false,
        formSubmitted: false,
        hasErrors: false,
        retryCount: 0,
        maxRetries: 3
    };

    // 在页面最上方添加实时进度状态栏
    function addProgressBar() {
        const progressBar = document.createElement('div');
        progressBar.id = 'eval-progress-bar';
        progressBar.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            background: linear-gradient(90deg, #1890ff, #52c41a);
            color: white;
            padding: 10px 15px;
            font-size: 14px;
            font-family: monospace;
            z-index: 99999;
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
            display: flex;
            justify-content: space-between;
            align-items: center;
            min-height: 40px;
        `;

        const statusText = document.createElement('div');
        statusText.id = 'eval-status-text';
        statusText.textContent = '评教助手: 等待页面加载...';

        const progressContainer = document.createElement('div');
        progressContainer.style.cssText = `
            display: flex;
            align-items: center;
            gap: 10px;
            flex: 1;
            margin: 0 20px;
        `;

        const progressBarInner = document.createElement('div');
        progressBarInner.style.cssText = `
            flex: 1;
            height: 6px;
            background: rgba(255,255,255,0.3);
            border-radius: 3px;
            overflow: hidden;
        `;

        const progressFill = document.createElement('div');
        progressFill.id = 'eval-progress-fill';
        progressFill.style.cssText = `
            width: 0%;
            height: 100%;
            background: white;
            border-radius: 3px;
            transition: width 0.3s ease;
        `;

        progressBarInner.appendChild(progressFill);

        const stepIndicator = document.createElement('span');
        stepIndicator.id = 'eval-step-indicator';
        stepIndicator.style.fontWeight = 'bold';
        stepIndicator.textContent = '步骤: 0/6';

        const debugBtn = document.createElement('button');
        debugBtn.textContent = '调试';
        debugBtn.style.cssText = `
            background: transparent;
            border: 1px solid white;
            color: white;
            font-size: 12px;
            cursor: pointer;
            padding: 4px 8px;
            border-radius: 3px;
            margin-right: 10px;
        `;
        debugBtn.onclick = function() {
            console.log('=== 调试信息 ===');
            console.log('当前状态:', state);
            console.log('找到单选题数量:', document.querySelectorAll('.index__selectGroup--Z1yeL').length);
            console.log('textarea:', document.querySelector('.index__UEditoTextarea--yga85'));
            console.log('提交按钮:', document.querySelector('.index__submit--jiKIA'));
        };

        progressContainer.appendChild(stepIndicator);
        progressContainer.appendChild(progressBarInner);

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '×';
        closeBtn.style.cssText = `
            background: transparent;
            border: none;
            color: white;
            font-size: 18px;
            cursor: pointer;
            padding: 0;
            width: 24px;
            height: 24px;
            line-height: 1;
            display: flex;
            align-items: center;
            justify-content: center;
        `;
        closeBtn.onclick = function() {
            progressBar.style.display = 'none';
        };

        progressBar.appendChild(statusText);
        progressBar.appendChild(debugBtn);
        progressBar.appendChild(progressContainer);
        progressBar.appendChild(closeBtn);

        document.body.insertBefore(progressBar, document.body.firstChild);

        // 添加样式以让页面内容不被进度条遮挡
        const paddingStyle = document.createElement('style');
        paddingStyle.textContent = `
            body { padding-top: 40px !important; }
            #eval-progress-bar.alert-error { background: linear-gradient(90deg, #ff4d4f, #ff7875); }
            #eval-progress-bar.alert-success { background: linear-gradient(90deg, #52c41a, #73d13d); }
        `;
        document.head.appendChild(paddingStyle);
    }

    // 更新进度状态
    function updateProgress(message, step = null) {
        if (step !== null) {
            state.step = step;
        }

        // 更新进度条填充
        const progressFill = document.getElementById('eval-progress-fill');
        if (progressFill) {
            const percentage = (state.step / state.totalSteps) * 100;
            progressFill.style.width = `${percentage}%`;
        }

        // 更新步骤指示器
        const stepIndicator = document.getElementById('eval-step-indicator');
        if (stepIndicator) {
            stepIndicator.textContent = `步骤: ${state.step}/${state.totalSteps}`;
        }

        // 更新状态文本
        const statusText = document.getElementById('eval-status-text');
        if (statusText) {
            statusText.textContent = `评教助手: ${message}`;
        }

        // 更新进度条样式
        const progressBar = document.getElementById('eval-progress-bar');
        if (progressBar) {
            progressBar.classList.remove('alert-error', 'alert-success');
            if (state.hasErrors) {
                progressBar.classList.add('alert-error');
            } else if (state.formSubmitted) {
                progressBar.classList.add('alert-success');
            }
        }

        // 控制台输出详细日志
        const timestamp = new Date().toLocaleTimeString();
        console.log(`%c[${timestamp}] [评教助手]`, 'color: #1890ff; font-weight: bold;', message);
    }

    // 专门处理单选按钮的函数
    function selectRadioOption(radioGroup, optionIndex) {
        if (!radioGroup) return false;

        const labels = radioGroup.querySelectorAll('label.ant-radio-wrapper');
        if (labels.length <= optionIndex) {
            console.log(`选项数量不足: ${labels.length}, 需要第${optionIndex}个`);
            return false;
        }

        const label = labels[optionIndex];
        const radioInput = label.querySelector('input[type="radio"]');

        console.log(`准备选择第${optionIndex}个选项: ${label.textContent.trim()}`);

        // 模拟点击标签，这应该触发React的事件处理
        label.click();

        // 等待React更新DOM
        setTimeout(() => {
            // 检查是否成功选中
            if (radioInput && radioInput.checked) {
                console.log(`✓ 成功选择: ${label.textContent.trim()}`);
                // 更新表单控件状态
                const controlDiv = radioGroup.closest('.ant-form-item-control');
                if (controlDiv) {
                    controlDiv.classList.remove('has-error', 'ant-form-item-with-help');
                    controlDiv.classList.add('has-success');
                    // 移除错误消息
                    const errorMsg = controlDiv.querySelector('.ant-form-explain');
                    if (errorMsg) {
                        errorMsg.remove();
                    }
                    // 更新父级form-item
                    const formItemDiv = controlDiv.closest('.ant-form-item');
                    if (formItemDiv) {
                        formItemDiv.classList.remove('ant-form-item-with-help');
                    }
                }
            } else {
                console.log(`✗ 选择失败，尝试手动设置`);
                // 备用方法：手动设置
                radioInput.checked = true;
                radioInput.setAttribute('checked', 'checked');
                label.classList.add('ant-radio-wrapper-checked');
                const radioSpan = label.querySelector('.ant-radio');
                if (radioSpan) {
                    radioSpan.classList.add('ant-radio-checked');
                }
                radioInput.dispatchEvent(new Event('change', { bubbles: true }));
                radioInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }, 80);

        return true;
    }

    // 检查表单错误状态
    function checkFormErrors() {
        const errorItems = document.querySelectorAll('.ant-form-item-control.has-error');
        const errorMessages = document.querySelectorAll('.ant-form-explain');

        console.log(`当前错误项: ${errorItems.length} 个`);
        errorMessages.forEach((msg, index) => {
            console.log(`错误 ${index}:`, msg.textContent);
        });

        return errorItems.length > 0;
    }

    // 移除表单错误状态（重置为初始状态）
    function clearFormErrors() {
        // 获取所有错误项
        const errorItems = document.querySelectorAll('.ant-form-item-control.has-error');
        errorItems.forEach(item => {
            item.classList.remove('has-error');
            const errorMessage = item.querySelector('.ant-form-explain');
            if (errorMessage && errorMessage.textContent.includes('题目为必答题')) {
                errorMessage.remove();
            }
        });

        console.log(`已清理 ${errorItems.length} 个错误状态`);
    }

    // 优化执行评教函数
    function executeEvaluation() {
        updateProgress('开始执行评教自动填写...', 2);

        // 首先清理错误状态
        clearFormErrors();

        // 等待一段时间让UI重置
        setTimeout(() => {
            // 获取所有评价问题项
            const subjectItems = getSubjectItems();
            state.foundItems = subjectItems.length;

            // 检查是否找到了评价项
            if (subjectItems.length === 0) {
                updateProgress('未找到评价问题，尝试重试...', 2);

                if (state.retryCount < state.maxRetries) {
                    state.retryCount++;
                    updateProgress(`第${state.retryCount}次重试，等待中...`, 2);
                    setTimeout(executeEvaluation, 1000);
                } else {
                    updateProgress('重试次数用完，请手动操作', 2);
                    state.hasErrors = true;
                }
                return;
            }

            updateProgress(`找到 ${subjectItems.length} 个评价项`, 3);

            // 遍历所有评价问题（排除最后一个textarea建议项）
            updateProgress('正在自动选择评价选项...', 3);

            let selectedCount = 0;
            for (let i = 0; i < subjectItems.length - 1; i++) {
                const item = subjectItems[i];
                const radioGroup = item.querySelector('.index__selectGroup--Z1yeL');

                if (radioGroup) {
                    // 判断是否为最后一个评价项
                    if (i === subjectItems.length - 2) {
                        // 最后一个单选题项
                        // 选择"大体同意"（第二个选项，value="2"）
                        if (selectRadioOption(radioGroup, 1)) {
                            selectedCount++;
                        }
                    } else {
                        // 选择"同意"（第一个选项，value="1"）
                        if (selectRadioOption(radioGroup, 0)) {
                            selectedCount++;
                        }
                    }
                }
            }

            state.selectedRadios = selectedCount;
            updateProgress(`已选择 ${selectedCount}/${subjectItems.length-1} 个评价项`, 4);

            // 启动空字段检查定时器
            startEmptyFieldCheckTimer();

            // 等待一段时间让选择生效
            setTimeout(() => {
                // 检查错误状态
                const hasErrors = checkFormErrors();

                if (hasErrors && state.retryCount < state.maxRetries) {
                    state.retryCount++;
                    updateProgress(`检测到表单错误，第${state.retryCount}次重试...`, 3);
                    setTimeout(executeEvaluation, 500);
                    return;
                }

                // 填写评教建议
                updateProgress('正在填写评教建议...', 4);
                const textarea = document.querySelector('.index__UEditoTextarea--yga85');
                if (textarea) {
                    // 先清空再设置值
                    textarea.value = '';
                    setTimeout(() => {
                        textarea.value = '教学优秀';
                        textarea.dispatchEvent(new Event('input', { bubbles: true }));
                        textarea.dispatchEvent(new Event('change', { bubbles: true }));
                        state.textareaFilled = true;
                        console.log('✓ 已填写评教建议: "教学优秀"');
                        updateProgress('评教建议已填写', 5);

                        // 提交表单
                        submitForm();
                    }, 100);
                } else {
                    console.log('❌ 未找到评教建议文本框');
                    updateProgress('未找到评教建议文本框', 4);
                    submitForm();
                }
            }, 300);
        }, 200);
    }

    // 提交表单函数
    function submitForm() {
        updateProgress('正在准备提交...', 5);

        // 再次检查错误状态
        const hasErrors = checkFormErrors();
        if (hasErrors) {
            updateProgress('检测到表单错误，无法提交', 5);
            state.hasErrors = true;
            return;
        }

        // 点击提交按钮
        const submitButton = document.querySelector('.index__submit--jiKIA');
        if (submitButton) {
            updateProgress('正在提交评教...', 6);
            submitButton.click();
            state.formSubmitted = true;

            console.log('✅ 评教已自动提交!');
            showSuccessMessage();
            updateProgress('评教已成功提交!', 6);
        } else {
            console.log('❌ 未找到提交按钮');
            updateProgress('未找到提交按钮，请手动提交', 5);
            state.hasErrors = true;
        }
    }

    // 显示成功消息
    function showSuccessMessage() {
        const successMessage = document.createElement('div');
        successMessage.style.cssText = `
            position: fixed;
            top: 60px;
            right: 20px;
            background: #52c41a;
            color: white;
            padding: 15px 25px;
            border-radius: 8px;
            z-index: 99998;
            font-size: 14px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            animation: slideIn 0.3s ease;
            max-width: 350px;
            font-family: monospace;
        `;

        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
        `;
        document.head.appendChild(style);

        successMessage.innerHTML = `
            <div style="font-weight: bold; margin-bottom: 5px; font-size: 16px;">✅ 评教自动提交成功</div>
            <div style="font-size: 12px; opacity: 0.9;">
                <div>评价项: ${state.foundItems} 个</div>
                <div>已选项: ${state.selectedRadios} 个</div>
                <div>建议: ${state.textareaFilled ? '✓ 已填写' : '✗ 未填写'}</div>
                <div>重试次数: ${state.retryCount}</div>
                <div>提交时间: ${new Date().toLocaleTimeString()}</div>
            </div>
        `;
        document.body.appendChild(successMessage);

        // 8秒后移除弹窗
        setTimeout(function() {
            if (successMessage.parentNode) {
                successMessage.style.opacity = '0';
                successMessage.style.transition = 'opacity 0.3s ease';
                setTimeout(() => {
                    if (successMessage.parentNode) {
                        successMessage.parentNode.removeChild(successMessage);
                    }
                }, 300);
            }
        }, 8000);
    }

    // 获取当前页面的评价项
    function getSubjectItems() {
        return document.querySelectorAll('.index__subjectItem--XWS1b');
    }

    // 检查当前页面是否为评教页面
    function isEvaluationPage() {
        const hash = window.location.hash;
        const isAnswerPage = hash.includes('/my-task/answer/');
        const subjectItems = getSubjectItems();
        const hasSubmitButton = document.querySelector('.index__submit--jiKIA') !== null;
        const hasRequiredError = document.querySelector('.ant-form-explain') !== null;

        state.isEvaluationPage = isAnswerPage || (subjectItems.length > 0 && hasSubmitButton) || hasRequiredError;
        return state.isEvaluationPage;
    }

    // 获取表单中的空选项（未填写的必答题）
    function getEmptyFields() {
        const emptyFields = [];
        const subjectItems = getSubjectItems();

        subjectItems.forEach((item, index) => {
            const radioGroup = item.querySelector('.index__selectGroup--Z1yeL');
            if (radioGroup) {
                const checkedRadio = radioGroup.querySelector('input[type="radio"]:checked');
                if (!checkedRadio) {
                    emptyFields.push(index);
                }
            }
        });

        return emptyFields;
    }

    // 主入口函数
    function main() {
        // 添加进度条
        addProgressBar();
        updateProgress('脚本已加载，正在初始化...', 0);

        // 延迟执行，确保页面完全加载
        setTimeout(() => {
            if (!isEvaluationPage()) {
                updateProgress('检测到非评教页面，脚本停止执行', 1);
                state.hasErrors = true;
                return;
            }

            updateProgress('检测到评教页面，等待内容完全加载...', 2);

            const subjectItems = getSubjectItems();
            if (subjectItems.length === 0) {
                updateProgress('未找到评价问题，等待动态加载...', 2);
                setTimeout(() => {
                    executeEvaluation();
                }, 3000);
                return;
            }

            executeEvaluation();
        }, 500);
    }

    // 监听哈希变化，因为这是一个单页应用
    let lastHash = window.location.hash;
    let hashChangeTimer = null;

    function resetEvaluationState() {
        state.step = 0;
        state.retryCount = 0;
        state.hasErrors = false;
        state.formSubmitted = false;
        state.selectedRadios = 0;
        state.textareaFilled = false;
        state.foundItems = 0;

        const progressFill = document.getElementById('eval-progress-fill');
        if (progressFill) {
            progressFill.style.width = '0%';
        }
    }

    window.addEventListener('hashchange', function() {
        if (window.location.hash !== lastHash) {
            lastHash = window.location.hash;

            if (hashChangeTimer) {
                clearTimeout(hashChangeTimer);
            }

            hashChangeTimer = setTimeout(() => {
                resetEvaluationState();
                updateProgress('检测到页面切换，重新检查...', 0);

                if (isEvaluationPage()) {
                    updateProgress('检测到新评教页面，准备自动填写...', 2);
                    setTimeout(() => {
                        executeEvaluation();
                    }, 500);
                }
            }, 200);
        }
    });

    // 创建重试按钮的函数
    function addRetryButton() {
        const retryBtn = document.createElement('button');
        retryBtn.textContent = '重试自动填写';
        retryBtn.style.cssText = `
            position: fixed;
            bottom: 80px;
            right: 20px;
            background: #1890ff;
            color: white;
            padding: 10px 20px;
            border-radius: 4px;
            border: none;
            cursor: pointer;
            z-index: 99999;
            font-size: 14px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        `;

        retryBtn.onclick = function() {
            updateProgress('手动重试自动填写...', 2);
            state.retryCount = 0;
            state.hasErrors = false;
            state.formSubmitted = false;
            startEmptyFieldCheckTimer();
            executeEvaluation();
        };

        document.body.appendChild(retryBtn);

        // 保存按钮引用以便后续操作
        state.retryButton = retryBtn;
    }

    // 定时检查空选项（用于同一URL-hash下的多个页面）
    let emptyFieldCheckTimer = null;

    function startEmptyFieldCheckTimer() {
        // 清除之前的定时器
        if (emptyFieldCheckTimer) {
            clearInterval(emptyFieldCheckTimer);
        }

        // 每3秒检查一次是否有空字段需要填写
        emptyFieldCheckTimer = setInterval(() => {
            if (state.formSubmitted) {
                clearInterval(emptyFieldCheckTimer);
                return;
            }

            const emptyFields = getEmptyFields();
            if (emptyFields.length > 0) {
                console.log(`[定时检查] 发现 ${emptyFields.length} 个空选项: ${emptyFields.join(', ')}`);
                updateProgress(`检测到 ${emptyFields.length} 个空选项未填写`, 4);
            }
        }, 2000);
    }

    // 监听页面变化和DOM更新
    const observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                // 检查新增节点中是否有评教相关元素
                const hasNewSubjectItems = document.querySelectorAll('.index__subjectItem--XWS1b').length > 0;
                const hasNewErrors = document.querySelectorAll('.ant-form-explain').length > 0;

                if ((hasNewSubjectItems || hasNewErrors) && !state.formSubmitted) {
                    console.log('[DOM观察器] 检测到新增的评教内容或错误');
                    if (!state.isEvaluationPage) {
                        state.isEvaluationPage = true;
                        updateProgress('动态检测到评教内容...', 2);
                        setTimeout(() => {
                            executeEvaluation();
                        }, 1000);
                    }
                }
            }

            // 检查表单类的变化
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === 1 && node.classList && node.classList.contains('ant-form-item-control')) {
                    console.log('[DOM观察器] 检测到表单控件变化');
                    setTimeout(() => {
                        if (!state.formSubmitted && isEvaluationPage()) {
                            executeEvaluation();
                        }
                    }, 500);
                }
            });
        });
    });

    // 开始观察文档变化
    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
    });

    // 等待页面加载完成
    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', main);
    } else {
        main();
    }

    // 添加重试按钮
    setTimeout(addRetryButton, 3000);
})();

